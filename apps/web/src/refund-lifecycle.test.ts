import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProductStore, accountHeader } from "./product-store.js";
import {
  coreStore,
  newRequest,
  preparePayment,
  reconcile,
  checkoutView,
  requestCustomerRefund,
  decideCustomerRefund,
  refundPayment,
  recoverOriginalRefundRoute,
  type ProductWallet,
} from "./product-service.js";
import { encodeMemo } from "../../../packages/memo/src/index.js";
import { ZalletRpcClient } from "../../../packages/zcash-adapter/src/index.js";
import { GET, POST } from "../app/api/product/[...action]/route.js";

let root: string,
  store: ProductStore,
  core: ReturnType<typeof coreStore>,
  rpc: ProductWallet;
const destination = "utest1" + "a".repeat(70),
  route = "utest1" + "b".repeat(70),
  paymentTxid = "c".repeat(64);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nostos-lifecycle-"));
  vi.stubEnv("NOSTOS_PRODUCT_DATABASE_PATH", join(root, "accounts.sqlite"));
  vi.stubEnv(
    "NOSTOS_PRODUCT_CORE_DATABASE_PATH",
    join(root, "payments.sqlite"),
  );
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "e".repeat(64));
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  store = new ProductStore();
  core = coreStore(store);
  rpc = {
    createAccount: vi.fn(),
    deriveOrchardAddress: vi.fn(),
    decodeUnifiedAddress: vi.fn(async (address) => ({ orchard: address })),
    listUnspent: vi.fn(async () => []),
    viewTransaction: vi.fn(),
    sendFromAccount: vi.fn(async () => "d".repeat(64)),
  };
});
afterEach(() => {
  core.close();
  store.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function merchant(email = "one@example.com") {
  const m = store.signup(email, "long-password-for-tests");
  store.finishSetup(m.id, "Test Store", "wallet-uuid", destination);
  return store.merchant(m.id)!;
}
async function paid(windowDays: number | null = null) {
  let m = merchant();
  if (windowDays !== null) {
    store.setRefundPolicy(m.id, "Refunds for undelivered orders.", windowDays);
    m = store.merchant(m.id)!;
  }
  const created = newRequest(store, m, "Paid item", 2000000);
  await preparePayment(store, store.checkout(created.id)!, route, rpc);
  const c = store.checkout(created.id)!;
  const incoming = {
    txid: paymentTxid,
    address: destination,
    outgoing: false,
    pool: "ironwood",
    valueZat: c.amountZat,
    memo: encodeMemo(c.order, route),
  };
  vi.mocked(rpc.listUnspent).mockResolvedValue([incoming]);
  vi.mocked(rpc.viewTransaction).mockResolvedValue({
    txid: paymentTxid,
    confirmations: 3,
    outputs: [incoming],
  });
  await reconcile(store, core, c, rpc);
  return { m, c: store.checkout(c.id)!, created, incoming };
}
function responseFor(
  incoming: Awaited<ReturnType<typeof paid>>["incoming"],
  refundTxid: string,
  amountZat: number,
) {
  vi.mocked(rpc.viewTransaction).mockImplementation(async (id) => ({
    txid: id,
    confirmations: 4,
    outputs:
      id === paymentTxid
        ? [incoming]
        : id === refundTxid
          ? [
              {
                address: route,
                outgoing: true,
                pool: "ironwood",
                valueZat: amountZat,
              },
            ]
          : [],
  }));
}
function post(
  action: string,
  body: unknown,
  token?: string,
  cookie?: string,
  origin = "https://nostos.example",
) {
  return new Request(`https://nostos.example/api/product/${action}`, {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("customer requests and merchant decisions", () => {
  it("records one encrypted request without wallet spending, then declines with a receipt-visible reason", async () => {
    const { m, c } = await paid();
    const id = randomUUID();
    const first = requestCustomerRefund(
      store,
      core,
      c,
      id,
      1800000,
      "Item never arrived.",
    );
    expect(
      requestCustomerRefund(store, core, c, id, 1800000, "Item never arrived.")
        .id,
    ).toBe(first.id);
    expect(() =>
      requestCustomerRefund(
        store,
        core,
        c,
        randomUUID(),
        100000,
        "Another request.",
      ),
    ).toThrow();
    expect(rpc.sendFromAccount).not.toHaveBeenCalled();
    await decideCustomerRefund(
      store,
      core,
      m,
      id,
      "declined",
      "Order was delivered.",
      undefined,
      rpc,
    );
    const view = checkoutView(store, core, c);
    expect(view.refundRequests[0]).toMatchObject({
      status: "declined",
      decisionReason: "Order was delivered.",
    });
    expect(view.canRequestRefund).toBe(true);
    expect(JSON.stringify(view)).not.toContain(route);
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const raw = readFileSync(join(root, "accounts.sqlite")).toString();
    expect(raw).not.toContain("Item never arrived.");
    expect(raw).not.toContain("Order was delivered.");
    expect(core.listRefundsByPayment(paymentTxid)).toEqual([]);
  });
  it("requires the merchant owner to approve and uses a fixed request key across lost responses", async () => {
    const { m, c } = await paid();
    const id = randomUUID();
    requestCustomerRefund(store, core, c, id, 1800000, "Item never arrived.");
    const other = merchant("two@example.com");
    await expect(
      decideCustomerRefund(
        store,
        core,
        other,
        id,
        "approved",
        "Refund approved.",
        1800000,
        rpc,
      ),
    ).rejects.toThrow();
    await expect(
      refundPayment(store, core, m, c.id, 1800000, rpc, randomUUID()),
    ).rejects.toThrow("open request");
    await decideCustomerRefund(
      store,
      core,
      m,
      id,
      "approved",
      "Refund approved.",
      1800000,
      rpc,
    );
    await decideCustomerRefund(
      store,
      core,
      m,
      id,
      "approved",
      "Refund approved.",
      1800000,
      rpc,
    );
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
    expect(rpc.sendFromAccount).toHaveBeenCalledWith("wallet-uuid", "orchard", [
      { address: route, amount: 0.018 },
    ]);
    expect(core.findRefundByKey(`refund_${id}`)).toMatchObject({
      status: "broadcast",
      retryCount: 1,
    });
    expect(() =>
      requestCustomerRefund(store, core, c, randomUUID(), 1, "More please."),
    ).toThrow();
    await expect(
      decideCustomerRefund(
        store,
        core,
        m,
        id,
        "approved",
        "Refund approved.",
        1700000,
        rpc,
      ),
    ).rejects.toThrow();
  });
  it("keeps an uncertain approved send reserved and blocks other keys", async () => {
    const { m, c } = await paid();
    const id = randomUUID();
    requestCustomerRefund(store, core, c, id, 1000000, "Order cancelled.");
    vi.mocked(rpc.sendFromAccount).mockRejectedValue(
      new Error(`wallet secret ${route}`),
    );
    await expect(
      decideCustomerRefund(
        store,
        core,
        m,
        id,
        "approved",
        "Refund approved.",
        1000000,
        rpc,
      ),
    ).rejects.toThrow();
    await expect(
      decideCustomerRefund(
        store,
        core,
        m,
        id,
        "approved",
        "Refund approved.",
        1000000,
        rpc,
      ),
    ).rejects.toThrow("unknown");
    expect(checkoutView(store, core, c, true).payment).toMatchObject({
      reservedZat: 1000000,
      canRefund: false,
    });
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
    await expect(
      refundPayment(store, core, m, c.id, 1000000, rpc, randomUUID()),
    ).rejects.toThrow();
  });
  it("confines receipt capability to requests and rejects other origins, extra destinations and another checkout", async () => {
    const { m, c, created } = await paid();
    const id = randomUUID();
    const body = {
      requestId: id,
      amountZat: 1000000,
      reason: "Order cancelled.",
    };
    expect((await POST(post("refund-request", body))).status).toBe(401);
    expect(
      (
        await POST(
          post(
            "refund-request",
            body,
            created.token,
            undefined,
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(post("refund-request", { ...body, route }, created.token)))
        .status,
    ).toBe(400);
    const r = await POST(post("refund-request", body, created.token));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(route);
    expect(
      (
        await POST(
          post(
            "refund-decision",
            {
              requestId: id,
              decision: "approve",
              amountZat: 1000000,
              reason: "Approved.",
            },
            created.token,
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (await POST(post("recover-route", { id: c.id }, created.token))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          post(
            "refund",
            { id: c.id, amountZat: 1000000, instructionId: randomUUID() },
            created.token,
          ),
        )
      ).status,
    ).toBe(401);
    const other = merchant("two@example.com");
    const cookie = accountHeader(store.session(other.id)).split(";")[0]!;
    const refused = await POST(
      post(
        "refund-decision",
        { requestId: id, decision: "decline", reason: "Declined." },
        undefined,
        cookie,
      ),
    );
    expect(refused.status).toBe(503);
    expect(await refused.text()).not.toContain(route);
    expect(rpc.sendFromAccount).not.toHaveBeenCalled();
    expect(store.merchant(m.id)).toBeDefined();
  });
  it("contains raw wallet errors in the actual approval API", async () => {
    const { m, c } = await paid();
    const id = randomUUID();
    requestCustomerRefund(store, core, c, id, 1000000, "Order cancelled.");
    vi.spyOn(
      ZalletRpcClient.prototype,
      "decodeUnifiedAddress",
    ).mockImplementation(async (address) => ({ orchard: address }));
    vi.spyOn(ZalletRpcClient.prototype, "sendFromAccount").mockRejectedValue(
      new Error(`private memo ${route}`),
    );
    vi.stubEnv("NOSTOS_MERCHANT_WALLET_RPC_URL", "http://127.0.0.1:1");
    vi.stubEnv("NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE", "/fixture");
    const cookie = accountHeader(store.session(m.id)).split(";")[0]!;
    const result = await POST(
      post(
        "refund-decision",
        {
          requestId: id,
          decision: "approve",
          reason: "Refund approved.",
          amountZat: 1000000,
        },
        undefined,
        cookie,
      ),
    );
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(route);
    expect(core.findRefundByKey(`refund_${id}`)?.status).toBe(
      "broadcast_unknown",
    );
  });
});

describe("remaining value and retention", () => {
  it("retains the route after a partial refund, then settles another request and retires only at full repayment", async () => {
    const { m, c, incoming } = await paid();
    const first = randomUUID();
    requestCustomerRefund(store, core, c, first, 1800000, "Order cancelled.");
    await decideCustomerRefund(
      store,
      core,
      m,
      first,
      "approved",
      "Refund approved.",
      1800000,
      rpc,
    );
    responseFor(incoming, "d".repeat(64), 1800000);
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    expect(store.checkout(c.id)?.route).toBe(route);
    expect(core.findByTxid(paymentTxid)?.refundAddress).toBe(route);
    const view = checkoutView(store, core, store.checkout(c.id)!, true);
    expect(view).toMatchObject({
      confirmedRefundAmountZat: 1800000,
      remainingAmountZat: 200000,
      canRequestRefund: true,
    });
    expect(view.payment?.canRefund).toBe(true);
    expect(view.refundRequests[0]?.status).toBe("settled");
    core.close();
    core = coreStore(store);
    const second = randomUUID();
    requestCustomerRefund(
      store,
      core,
      store.checkout(c.id)!,
      second,
      200000,
      "Remaining refund.",
    );
    vi.mocked(rpc.sendFromAccount).mockResolvedValue("f".repeat(64));
    await decideCustomerRefund(
      store,
      core,
      m,
      second,
      "approved",
      "Final refund.",
      200000,
      rpc,
    );
    responseFor(incoming, "f".repeat(64), 200000);
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    expect(store.checkout(c.id)?.route).toBe("");
    expect(core.findByTxid(paymentTxid)).toMatchObject({
      status: "refunded",
      refundAddress: "",
    });
    const final = checkoutView(store, core, store.checkout(c.id)!);
    expect(final).toMatchObject({
      confirmedRefundAmountZat: 2000000,
      remainingAmountZat: 0,
      canRequestRefund: false,
    });
    expect(final.refunds).toHaveLength(2);
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(final)).not.toContain(route);
  });
  it("rejects cumulative over-refunding and a second key during an active send", async () => {
    const { m, c, incoming } = await paid();
    const first = randomUUID();
    await refundPayment(store, core, m, c.id, 1800000, rpc, first);
    await expect(
      refundPayment(store, core, m, c.id, 1, rpc, randomUUID()),
    ).rejects.toThrow("in progress");
    responseFor(incoming, "d".repeat(64), 1800000);
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    await expect(
      refundPayment(store, core, m, c.id, 200001, rpc, randomUUID()),
    ).rejects.toThrow("remaining");
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
  });
  it("does not retire a route until the exact outgoing refund is confirmed", async () => {
    const { m, c, incoming } = await paid();
    await refundPayment(store, core, m, c.id, 2000000, rpc, randomUUID());
    vi.mocked(rpc.viewTransaction).mockImplementation(async (id) => ({
      txid: id,
      confirmations: 3,
      outputs:
        id === paymentTxid
          ? [incoming]
          : [
              {
                address: route,
                pool: "sapling",
                valueZat: 2000000,
                outgoing: true,
              },
            ],
    }));
    await reconcile(store, core, c, rpc);
    expect(core.findRefundByPayment(paymentTxid)?.status).toBe("broadcast");
    expect(store.checkout(c.id)?.route).toBe(route);
    responseFor(incoming, "d".repeat(64), 2000000);
    await reconcile(store, core, c, rpc);
    expect(store.checkout(c.id)?.route).toBe("");
  });
  it("snapshots a policy for new requests without changing older payments, and retires an expired route", async () => {
    const { m, c } = await paid();
    store.setRefundPolicy(m.id, "Returns within seven days.", 7);
    expect(store.checkout(c.id)?.refundExpiresAt).toBeNull();
    const future = newRequest(
      store,
      store.merchant(m.id)!,
      "Next item",
      1000000,
    );
    expect(store.checkout(future.id)).toMatchObject({
      refundWindowDays: 7,
      refundPolicy: "Returns within seven days.",
    });
    store.db
      .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
      .run("2020-01-01T00:00:00.000Z", c.id);
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    expect(store.checkout(c.id)).toMatchObject({
      route: "",
      routeClosedReason: "expired",
    });
    expect(checkoutView(store, core, store.checkout(c.id)!)).toMatchObject({
      canRequestRefund: false,
    });
    await expect(
      recoverOriginalRefundRoute(store, core, m, c.id, rpc),
    ).rejects.toThrow();
  });
  it("keeps an open request through expiry until the merchant resolves it", async () => {
    const { m, c } = await paid(1);
    const id = randomUUID();
    requestCustomerRefund(store, core, c, id, 500000, "Not delivered.");
    store.db
      .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
      .run("2020-01-01T00:00:00.000Z", c.id);
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    expect(store.checkout(c.id)?.route).toBe(route);
    await decideCustomerRefund(
      store,
      core,
      m,
      id,
      "declined",
      "Order was delivered.",
      undefined,
      rpc,
    );
    await reconcile(store, core, store.checkout(c.id)!, rpc);
    expect(store.checkout(c.id)?.route).toBe("");
  });
  it("recovers a legacy partial route only from the exact original memo and stored fingerprint", async () => {
    const { m, c, incoming } = await paid();
    await refundPayment(store, core, m, c.id, 1800000, rpc, randomUUID());
    responseFor(incoming, "d".repeat(64), 1800000);
    await reconcile(store, core, c, rpc);
    core.expireRefundRoute(paymentTxid);
    store.retireRoute(c.id);
    // Old deployed rows have no explicit route-closure reason.
    store.db
      .prepare("UPDATE checkouts SET route_closed_reason=NULL WHERE id=?")
      .run(c.id);
    expect(
      checkoutView(store, core, store.checkout(c.id)!, true).canRecoverRoute,
    ).toBe(true);
    const other = merchant("other@example.com");
    await expect(
      recoverOriginalRefundRoute(store, core, other, c.id, rpc),
    ).rejects.toThrow();
    const wrong = "utest1" + "z".repeat(70);
    vi.mocked(rpc.viewTransaction).mockResolvedValue({
      txid: paymentTxid,
      confirmations: 4,
      outputs: [{ ...incoming, memo: encodeMemo(c.order, wrong) }],
    });
    await expect(
      recoverOriginalRefundRoute(store, core, m, c.id, rpc),
    ).rejects.toThrow("uniquely proven");
    responseFor(incoming, "d".repeat(64), 1800000);
    await recoverOriginalRefundRoute(store, core, m, c.id, rpc);
    expect(store.checkout(c.id)?.route).toBe(route);
    expect(core.findByTxid(paymentTxid)).toMatchObject({
      refundAddress: route,
      status: "confirmed",
    });
    expect(
      checkoutView(store, core, store.checkout(c.id)!, true).payment?.canRefund,
    ).toBe(true);
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
  });
});

it("projects request reasons as scoped data without allowing anonymous reads", async () => {
  const { c, created } = await paid();
  requestCustomerRefund(
    store,
    core,
    c,
    randomUUID(),
    100000,
    "Private cancellation reason.",
  );
  expect(
    (await GET(new Request("https://nostos.example/api/product/checkout")))
      .status,
  ).toBe(401);
  // Avoid an unrelated wallet call: the stored receipt stays readable during wallet failure.
  const r = await GET(
    new Request("https://nostos.example/api/product/checkout", {
      headers: { Authorization: `Bearer ${created.token}` },
    }),
  );
  expect(r.status).toBe(200);
  const body = await r.text();
  expect(body).toContain("Private cancellation reason.");
  expect(body).not.toContain(route);
  expect(body).not.toContain(created.token);
});

it("expires unused routes without a receipt visit but preserves open requests and pending sends", async () => {
  const { retireExpiredProductRoutes } = await import("./retention.js");
  const { m, c } = await paid(1);
  const requestId = randomUUID();
  requestCustomerRefund(store, core, c, requestId, 100000, "Order cancelled.");
  store.db
    .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", c.id);
  expect(retireExpiredProductRoutes(store, core)).toBe(0);
  await decideCustomerRefund(
    store,
    core,
    m,
    requestId,
    "declined",
    "Order delivered.",
    undefined,
    rpc,
  );
  expect(retireExpiredProductRoutes(store, core)).toBe(1);
  expect(store.checkout(c.id)).toMatchObject({
    route: "",
    routeClosedReason: "expired",
  });
  expect(retireExpiredProductRoutes(store, core)).toBe(0);
  expect(rpc.sendFromAccount).not.toHaveBeenCalled();
});

it("rechecks a direct refund after wallet validation if a customer request arrived meanwhile", async () => {
  const { m, c } = await paid();
  let finish!: () => void;
  vi.mocked(rpc.decodeUnifiedAddress).mockImplementationOnce(
    (address) =>
      new Promise((resolve) => {
        finish = () => resolve({ orchard: address });
      }),
  );
  const direct = refundPayment(store, core, m, c.id, 500000, rpc, randomUUID());
  requestCustomerRefund(
    store,
    core,
    c,
    randomUUID(),
    1000000,
    "Order cancelled.",
  );
  finish();
  await expect(direct).rejects.toThrow("open request");
  expect(core.listRefundsByPayment(paymentTxid)).toHaveLength(0);
  expect(rpc.sendFromAccount).not.toHaveBeenCalled();
});

it("background expiry preserves a refund with an unknown broadcast outcome", async () => {
  const { retireExpiredProductRoutes } = await import("./retention.js");
  const { m, c } = await paid(1);
  vi.mocked(rpc.sendFromAccount).mockRejectedValue(
    new Error("Transport failed."),
  );
  await expect(
    refundPayment(store, core, m, c.id, 100000, rpc, randomUUID()),
  ).rejects.toThrow();
  store.db
    .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", c.id);
  expect(retireExpiredProductRoutes(store, core)).toBe(0);
  expect(store.checkout(c.id)?.route).toBe(route);
});
