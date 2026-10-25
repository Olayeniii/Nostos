import { GET, POST } from "../app/api/product/[...action]/route.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProductStore, accountHeader } from "./product-store.js";
import { coreStore, newRequest, checkoutView } from "./product-service.js";
import { observerConnection } from "./merchant-observer.js";
import {
  reconcileObservedPayment,
  detectObservedPayment,
  prepareObservedRefund,
  claimObservedRefund,
  bindObservedRefund,
  reconcileObservedRefund,
} from "./observer-records.js";

let root: string,
  store: ProductStore,
  core: ReturnType<typeof coreStore>,
  merchant: string;
let requests: Array<{ method: string; params: unknown[] }>;
let transform: (proof: Record<string, unknown>) => Record<string, unknown>;
const account = "afcf8468-1814-4fea-a9f6-ce5a57505078",
  destination = "u1" + "b".repeat(60),
  route = "u1" + "r".repeat(60);
const paymentTx = "a".repeat(64),
  refundTx = "d".repeat(64);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nostos-observer-records-"));
  vi.stubEnv("NOSTOS_NETWORK", "mainnet");
  vi.stubEnv("NOSTOS_MAINNET_ENABLED", "yes");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_DATABASE_PATH",
    join(root, "product.sqlite"),
  );
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_CORE_DATABASE_PATH",
    join(root, "core.sqlite"),
  );
  vi.stubEnv("NOSTOS_MAINNET_PRODUCT_DATA_KEY", "b".repeat(64));
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "e".repeat(64));
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38235");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE", join(root, "cookie"));
  writeFileSync(join(root, "cookie"), "public-test:fixture-only", {
    mode: 0o600,
  });
  store = new ProductStore();
  core = coreStore(store);
  merchant = store.signup("observer@example.com", "test-password-long").id;
  store.db
    .prepare("UPDATE merchants SET email_verified_at=?,name=? WHERE id=?")
    .run(new Date().toISOString(), store.encrypt("Fixture store"), merchant);
  observerConnection(store, merchant);
  store.db
    .prepare(`INSERT INTO merchant_observers VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(
      merchant,
      "mainnet",
      "f".repeat(64),
      store.encrypt("public fixture only"),
      100,
      "sdk-orchard-view-access-v1",
      new Date().toISOString(),
      "connected",
      store.encrypt(account),
      store.encrypt(destination),
    );
  requests = [];
  transform = (p) => p;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      requests.push(request);
      const [
        namespace,
        acct,
        txid,
        ,
        amount,
        ,
        pool,
        direction,
        binding,
        feeCap,
      ] = request.params;
      expect(namespace).toBe(merchant);
      let result: unknown;
      if (request.method === "getwalletstatus")
        result = transform({
          nostos_sdk_preview_v1: true,
          payments_enabled: false,
          observation_scope: "orchard-family-only",
          account_connected: true,
          locked: false,
          node_tip: { height: 102, blockhash: "f".repeat(64) },
          wallet_tip: { height: 102, blockhash: "f".repeat(64) },
          fully_synced_height: 102,
        });
      else if (request.method === "nostos_incoming_candidates")
        result = transform({
          nostos_sdk_preview_v1: true,
          payments_enabled: false,
          observation_scope: "orchard-family-only",
          candidates: [[1, paymentTx]],
        });
      else if (request.method === "z_listunifiedreceivers")
        result = { orchard: request.params[1] };
      else {
        expect(request.method).toBe("nostos_verify_output");
        result = transform({
          nostos_output_proof_v1: true,
          network: "mainnet",
          observation_scope: "orchard-family-only",
          payments_enabled: false,
          binding,
          account_uuid: acct,
          txid,
          pool,
          direction,
          amount_zat: amount,
          exact_match: true,
          owned_spend: direction === "outgoing",
          height: 100,
          tip_height: 102,
          confirmations: 3,
          block_hash: "c".repeat(64),
          tip_hash: "f".repeat(64),
          output_index: 0,
          fee_zat: direction === "outgoing" ? Math.min(1000, feeCap) : null,
        });
      }
      return new Response(JSON.stringify({ result }));
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  core.close();
  store.close();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function checkout(refundRoute = route) {
  const c = store.createRequest(
    merchant,
    "Fixture item",
    `n_${randomUUID().replaceAll("-", "")}`,
    100000,
  ).checkout;
  store.setRoute(c.id, refundRoute);
  return store.checkout(c.id)!;
}
async function paid() {
  const c = checkout();
  await reconcileObservedPayment(store, core, merchant, c.id, paymentTx);
  return store.checkout(c.id)!;
}
function approve(checkoutId: string, amount = 40000) {
  const id = randomUUID();
  store.createRefundRequest(checkoutId, id, amount, "Fixture reason");
  store.decideRefundRequest(id, "approved", "Approved fixture", amount);
  return id;
}

it("builds expectations from saved checkout data and projects a verified payment into its receipt", async () => {
  const c = checkout();
  const result = await reconcileObservedPayment(
    store,
    core,
    merchant,
    c.id,
    paymentTx,
  );
  expect(result).toMatchObject({
    paymentStatus: "confirmed",
    paymentConfirmations: 3,
    paymentTxid: paymentTx,
  });
  const sent = requests.find(
    (r) => r.method === "nostos_verify_output",
  )!.params;
  expect(sent.slice(0, 5)).toEqual([
    merchant,
    account,
    paymentTx,
    destination,
    100000,
  ]);
  expect(Buffer.from(sent[5] as string, "hex").toString()).toContain(c.order);
  expect(Buffer.from(sent[5] as string, "hex").toString()).toContain(route);
  expect(JSON.stringify(result)).not.toContain(route);
  expect(JSON.stringify(result)).not.toContain(account);
  expect(() =>
    newRequest(store, store.merchant(merchant)!, "Still held", 1000),
  ).toThrow(/Merchant-controlled/);
});
it("reserves a saved approved refund and treats a supplied txid only as an unresolved candidate", async () => {
  const c = await paid(),
    id = approve(c.id);
  const first = await prepareObservedRefund(store, core, merchant, id, 5000);
  const again = await prepareObservedRefund(store, core, merchant, id, 5000);
  expect(first).toEqual(again);
  expect(first).toMatchObject({
    recipient: route,
    amountZat: 40000,
    pool: "ironwood",
    requiresWalletApproval: true,
  });
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  expect(core.refundTotals(paymentTx)).toEqual({
    refundedZat: 0,
    reservedZat: 40000,
    inProgress: true,
  });
  expect(core.findRefund(first.refundId)?.status).toBe("broadcasting");
  expect(store.refundRequest(id)?.status).toBe("approved");
  expect(() =>
    bindObservedRefund(store, core, merchant, id, "e".repeat(64)),
  ).toThrow("unresolved");
  expect(core.findRefund(first.refundId)?.txid).toBeUndefined();
});
it("confirms a partial refund exactly once and keeps the remaining receipt amount and route", async () => {
  const c = await paid(),
    id = approve(c.id);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  const result = await reconcileObservedRefund(store, core, merchant, id);
  expect(result).toMatchObject({
    confirmedRefundAmountZat: 40000,
    pendingRefundAmountZat: 0,
    remainingAmountZat: 60000,
  });
  expect(store.refundRequest(id)?.status).toBe("settled");
  expect(store.checkout(c.id)?.route).toBe(route);
  const calls = requests.length;
  expect(await reconcileObservedRefund(store, core, merchant, id)).toEqual(
    result,
  );
  expect(requests.length).toBe(calls);
  expect(core.listRefundsByPayment(paymentTx)).toHaveLength(1);
});
it("retires both route copies after a full refund without retaining them in the proof journal", async () => {
  const c = await paid(),
    id = approve(c.id, 100000);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  const result = await reconcileObservedRefund(store, core, merchant, id);
  expect(result.confirmedRefundAmountZat).toBe(100000);
  expect(store.checkout(c.id)?.route).toBe("");
  expect(core.findByTxid(paymentTx)?.refundAddress).toBe("");
  const rows = JSON.stringify(
    core
      .withdrawalDatabase()
      .prepare("SELECT * FROM observer_record_instructions")
      .all(),
  );
  for (const value of [route, account, c.order])
    expect(rows).not.toContain(value);
  for (const file of readdirSync(root).filter((f) => f.includes("sqlite")))
    expect(readFileSync(join(root, file)).includes(Buffer.from(route))).toBe(
      false,
    );
  expect(await reconcileObservedRefund(store, core, merchant, id)).toEqual(
    result,
  );
});
it.each([
  "binding",
  "account_uuid",
  "txid",
  "pool",
  "direction",
  "amount_zat",
  "owned_spend",
  "exact_match",
  "confirmations",
  "tip_height",
  "block_hash",
  "payments_enabled",
  "network",
  "fee_zat",
  "height",
  "output_index",
  "nostos_output_proof_v1",
])(
  "keeps the refund reservation unresolved on a mismatched proof field: %s",
  async (field) => {
    const c = await paid(),
      id = approve(c.id);
    await prepareObservedRefund(store, core, merchant, id, 5000);
    claimObservedRefund(store, core, merchant, id);
    bindObservedRefund(store, core, merchant, id, refundTx);
    transform = (p) => ({
      ...p,
      [field]:
        field === "payments_enabled"
          ? true
          : field === "confirmations"
            ? 2
            : "wrong",
    });
    await expect(
      reconcileObservedRefund(store, core, merchant, id),
    ).rejects.toThrow("unresolved");
    expect(core.refundTotals(paymentTx)).toEqual({
      refundedZat: 0,
      reservedZat: 40000,
      inProgress: true,
    });
    expect(store.refundRequest(id)?.status).toBe("approved");
    expect(store.checkout(c.id)?.route).toBe(route);
  },
);
it("rejects a control-test report as product evidence", async () => {
  const c = checkout();
  transform = () => ({
    nostos_control_v1: true,
    passed: true,
    payments_enabled: false,
  });
  await expect(
    reconcileObservedPayment(store, core, merchant, c.id, paymentTx),
  ).rejects.toThrow("unresolved");
  expect(core.paymentCount()).toBe(0);
  expect(store.checkout(c.id)?.status).toBe("unpaid");
});
it("recovers a core commit after product projection fails, including after reopening both stores", async () => {
  const c = checkout();
  vi.spyOn(store, "recordPayment").mockImplementationOnce(() => {
    throw Error("interrupted");
  });
  await expect(
    reconcileObservedPayment(store, core, merchant, c.id, paymentTx),
  ).rejects.toThrow("unresolved");
  expect(core.paymentCount()).toBe(1);
  expect(store.checkout(c.id)?.status).toBe("unpaid");
  core.close();
  store.close();
  store = new ProductStore();
  core = coreStore(store);
  const calls = requests.length;
  const result = await reconcileObservedPayment(
    store,
    core,
    merchant,
    c.id,
    paymentTx,
  );
  expect(result.paymentStatus).toBe("confirmed");
  expect(requests.length).toBe(calls);
  expect(core.paymentCount()).toBe(1);
});
it("recovers an already confirmed refund projection without another proof, refund or debit", async () => {
  const c = await paid(),
    id = approve(c.id, 100000);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  vi.spyOn(store, "settleRefundRequest").mockImplementationOnce(() => {
    throw Error("interrupted");
  });
  await expect(
    reconcileObservedRefund(store, core, merchant, id),
  ).rejects.toThrow("unresolved");
  expect(core.refundTotals(paymentTx).refundedZat).toBe(100000);
  expect(store.refundRequest(id)?.status).toBe("approved");
  core.close();
  store.close();
  store = new ProductStore();
  core = coreStore(store);
  const calls = requests.length;
  expect(
    (await reconcileObservedRefund(store, core, merchant, id))
      .confirmedRefundAmountZat,
  ).toBe(100000);
  expect(requests.length).toBe(calls);
  expect(core.listRefundsByPayment(paymentTx)).toHaveLength(1);
});
it("rejects a reused transaction across checkouts and rejects another merchant before RPC", async () => {
  const first = await paid(),
    second = checkout("u1" + "s".repeat(60));
  await expect(
    reconcileObservedPayment(store, core, merchant, second.id, paymentTx),
  ).rejects.toThrow("unresolved");
  expect(store.checkout(second.id)?.status).toBe("unpaid");
  expect(core.paymentCount()).toBe(1);
  const calls = requests.length;
  await expect(
    reconcileObservedPayment(store, core, randomUUID(), first.id, paymentTx),
  ).rejects.toThrow("unresolved");
  expect(requests.length).toBe(calls);
});
it("rechecks saved approval after the asynchronous observer response", async () => {
  const c = await paid(),
    id = approve(c.id);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  transform = (p) => {
    store.db
      .prepare(
        "UPDATE refund_requests SET approved_zat=approved_zat+1 WHERE id=?",
      )
      .run(id);
    return p;
  };
  await expect(
    reconcileObservedRefund(store, core, merchant, id),
  ).rejects.toThrow("unresolved");
  expect(core.refundTotals(paymentTx).reservedZat).toBe(40000);
  expect(core.refundTotals(paymentTx).refundedZat).toBe(0);
});
it("keeps receipt totals unchanged on timeout and omits raw provider errors", async () => {
  const c = await paid(),
    id = approve(c.id);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  const before = checkoutView(store, core, store.checkout(c.id)!);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("private provider diagnostic " + route);
    }),
  );
  await expect(
    reconcileObservedRefund(store, core, merchant, id),
  ).rejects.toThrow(/^Observer reconciliation is unresolved/);
  expect(checkoutView(store, core, store.checkout(c.id)!)).toEqual(before);
});

it("confirms an unknown attempt only after matching native evidence", async () => {
  const c = await paid(),
    id = approve(c.id);
  const plan = await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  core.markRefundBroadcastUnknown(paymentTx, plan.refundId);
  bindObservedRefund(store, core, merchant, id, refundTx);
  expect(core.refundTotals(paymentTx).reservedZat).toBe(40000);
  expect(
    (await reconcileObservedRefund(store, core, merchant, id))
      .confirmedRefundAmountZat,
  ).toBe(40000);
  expect(core.findRefund(plan.refundId)?.status).toBe("confirmed");
});
it("cannot reopen an instruction closed as failed", async () => {
  const c = await paid(),
    id = approve(c.id);
  const plan = await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  core
    .withdrawalDatabase()
    .prepare("UPDATE refund_events SET status='failed' WHERE id=?")
    .run(plan.refundId);
  await expect(
    reconcileObservedRefund(store, core, merchant, id),
  ).rejects.toThrow("unresolved");
  expect(core.findRefund(plan.refundId)?.status).toBe("failed");
  expect(store.refundRequest(id)?.status).toBe("approved");
});
it("replaying a settled partial refund preserves a later refund reservation", async () => {
  const c = await paid(),
    first = approve(c.id);
  await prepareObservedRefund(store, core, merchant, first, 5000);
  claimObservedRefund(store, core, merchant, first);
  bindObservedRefund(store, core, merchant, first, refundTx);
  await reconcileObservedRefund(store, core, merchant, first);
  const second = approve(c.id, 20000);
  await prepareObservedRefund(store, core, merchant, second, 5000);
  const result = await reconcileObservedRefund(store, core, merchant, first);
  expect(result).toMatchObject({
    confirmedRefundAmountZat: 40000,
    pendingRefundAmountZat: 20000,
    remainingAmountZat: 40000,
  });
  expect(store.checkout(c.id)?.route).toBe(route);
});

it("does not record a second payment when competing pool hints resolve out of order", async () => {
  const c = checkout(),
    secondTx = "e".repeat(64),
    original = globalThis.fetch;
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const result = await original(input, options);
      const body = JSON.parse(String(options?.body));
      if (
        body.method === "nostos_verify_output" &&
        body.params[2] === secondTx
      ) {
        entered();
        await waiting;
      }
      return result;
    }),
  );
  const later = reconcileObservedPayment(
    store,
    core,
    merchant,
    c.id,
    secondTx,
    "orchard",
  );
  const rejected = expect(later).rejects.toThrow("unresolved");
  await started;
  await reconcileObservedPayment(store, core, merchant, c.id, paymentTx);
  release();
  await rejected;
  expect(core.paymentCount()).toBe(1);
  expect(store.checkout(c.id)?.paymentTxid).toBe(paymentTx);
});
it("rejects testnet runtime before accessing the observer", async () => {
  const c = checkout();
  vi.stubEnv("NOSTOS_NETWORK", "testnet");
  await expect(
    reconcileObservedPayment(store, core, merchant, c.id, paymentTx),
  ).rejects.toThrow("unresolved");
  expect(requests).toHaveLength(0);
  expect(core.paymentCount()).toBe(0);
});

it("grants the wallet handoff only once and refuses binding before it", async () => {
  const c = await paid(),
    id = approve(c.id);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  expect(() => bindObservedRefund(store, core, merchant, id, refundTx)).toThrow(
    "unresolved",
  );
  expect(claimObservedRefund(store, core, merchant, id).handoffGranted).toBe(
    true,
  );
  core.close();
  store.close();
  store = new ProductStore();
  core = coreStore(store);
  expect(() => claimObservedRefund(store, core, merchant, id)).toThrow(
    "unresolved",
  );
  expect(
    (await prepareObservedRefund(store, core, merchant, id, 5000))
      .handoffStarted,
  ).toBe(true);
  bindObservedRefund(store, core, merchant, id, refundTx);
  expect(() => claimObservedRefund(store, core, merchant, id)).toThrow(
    "unresolved",
  );
});

it("serves verified refund accounting through the private receipt API", async () => {
  const c = await paid(),
    id = approve(c.id);
  await prepareObservedRefund(store, core, merchant, id, 5000);
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  await reconcileObservedRefund(store, core, merchant, id);
  expect(
    (await GET(new Request("http://localhost/api/product/checkout"))).status,
  ).toBe(401);
  const response = await GET(
    new Request("http://localhost/api/product/checkout", {
      headers: {
        authorization: `Bearer ${store.receiptToken(c.id, merchant)}`,
      },
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.receipt).toMatchObject({
    confirmedRefundAmountZat: 40000,
    remainingAmountZat: 60000,
  });
  expect(JSON.stringify(body)).not.toContain(account);
  expect(JSON.stringify(body)).not.toContain("nostos_output_proof_v1");
});

function previewRequest(
  action: string,
  body: unknown,
  options: { origin?: string; cookie?: boolean; actor?: string } = {},
) {
  return new Request(`https://nostos.example/api/product/${action}`, {
    method: "POST",
    headers: {
      origin: options.origin ?? "https://nostos.example",
      "content-type": "application/json",
      ...(options.cookie === false
        ? {}
        : {
            cookie: accountHeader(
              store.session(options.actor ?? merchant),
            ).split(";")[0]!,
          }),
    },
    body: JSON.stringify(body),
  });
}
it("holds record-check routes by default without calling the observer", async () => {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  const c = checkout();
  const response = await POST(
    previewRequest("observer-payment-check", {
      id: c.id,
      txid: paymentTx,
      pool: "ironwood",
    }),
  );
  expect(response.status).toBe(409);
  expect(requests).toHaveLength(0);
  expect(core.paymentCount()).toBe(0);
});
it("checks a payment through the authorized opt-in route and private receipt projection", async () => {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "yes");
  const c = checkout();
  const response = await POST(
    previewRequest("observer-payment-check", {
      id: c.id,
      txid: paymentTx,
      pool: "ironwood",
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).receipt).toMatchObject({
    paymentStatus: "confirmed",
    paymentTxid: paymentTx,
  });
  expect(core.paymentCount()).toBe(1);
  const body = await (
    await POST(
      previewRequest("observer-payment-check", {
        id: c.id,
        txid: paymentTx,
        pool: "ironwood",
      }),
    )
  ).text();
  expect(body).not.toContain(account);
  expect(body).not.toContain("nostos_output_proof_v1");
  expect(core.paymentCount()).toBe(1);
  expect(requests.every((r) => r.method === "nostos_verify_output")).toBe(true);
});
it("enforces session, origin, strict fields and merchant ownership before record proof RPC", async () => {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "yes");
  const c = checkout(),
    body = { id: c.id, txid: paymentTx, pool: "ironwood" };
  expect(
    (
      await POST(
        previewRequest("observer-payment-check", body, { cookie: false }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await POST(
        previewRequest("observer-payment-check", body, {
          origin: "https://evil.example",
        }),
      )
    ).status,
  ).toBe(403);
  for (const extra of [
    { receiver: route },
    { amountZat: 1 },
    { memo: "different" },
    { merchantId: merchant },
  ]) {
    expect(
      (
        await POST(
          previewRequest("observer-payment-check", { ...body, ...extra }),
        )
      ).status,
    ).toBe(400);
  }
  const other = store.signup(
    "other-preview@example.com",
    "a-long-test-password",
  ).id;
  store.db
    .prepare("UPDATE merchants SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), other);
  expect(
    (
      await POST(
        previewRequest("observer-payment-check", body, { actor: other }),
      )
    ).status,
  ).toBe(409);
  expect(requests).toHaveLength(0);
  expect(core.paymentCount()).toBe(0);
});
it("does not let the refund proof route create a handoff or accept caller transaction fields", async () => {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "yes");
  const c = await paid(),
    id = approve(c.id);
  const plan = await prepareObservedRefund(store, core, merchant, id, 5000);
  const before = requests.length;
  expect(
    (
      await POST(
        previewRequest("observer-refund-check", {
          requestId: id,
          txid: refundTx,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(previewRequest("observer-refund-check", { requestId: id })))
      .status,
  ).toBe(409);
  expect(requests).toHaveLength(before);
  expect(core.findRefund(plan.refundId)?.status).toBe("pending");
  claimObservedRefund(store, core, merchant, id);
  bindObservedRefund(store, core, merchant, id, refundTx);
  const result = await POST(
    previewRequest("observer-refund-check", { requestId: id }),
  );
  expect(result.status).toBe(200);
  expect((await result.json()).receipt.confirmedRefundAmountZat).toBe(40000);
  expect(core.findRefund(plan.refundId)?.status).toBe("confirmed");
});

it("returns live wallet readiness through a tenant-scoped read-only endpoint without private fields", async () => {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  const url = "https://nostos.example/api/product/wallet-status";
  expect((await GET(new Request(url))).status).toBe(401);
  expect((await POST(previewRequest("wallet-status", {}))).status).toBe(405);
  const call = vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(body.method).toBe("getwalletstatus");
    expect(body.params).toEqual([merchant]);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        nostos_sdk_preview_v1: true,
        observation_scope: "orchard-family-only",
        payments_enabled: false,
        account_connected: true,
        locked: false,
        node_tip: { height: 103, blockhash: "b".repeat(64) },
        wallet_tip: { height: 103, blockhash: "b".repeat(64) },
        fully_synced_height: 103,
        account_uuid: account,
        extra: "provider details must not escape",
      },
    });
  });
  vi.stubGlobal("fetch", call);
  const cookie = accountHeader(store.session(merchant)).split(";")[0]!;
  const response = await GET(new Request(url, { headers: { cookie } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: {
      state: "ready",
      nodeHeight: 103,
      scannedHeight: 103,
      paymentsEnabled: false,
      signingEnabled: false,
    },
  });
  expect(call).toHaveBeenCalledTimes(1);
  call.mockRejectedValueOnce(new Error("private provider details"));
  const failed = await GET(new Request(url, { headers: { cookie } }));
  expect(failed.status).toBe(409);
  expect(await failed.text()).not.toContain("private provider details");
});

function commerce() {
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "yes");
  vi.stubEnv("NOSTOS_MAINNET_COMMERCE_PREVIEW", "yes");
}
function customerRequest(action: string, receiptToken: string, body: unknown) {
  return new Request(`https://nostos.example/api/product/${action}`, {
    method: "POST",
    headers: {
      origin: "https://nostos.example",
      authorization: `Bearer ${receiptToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("creates a merchant-controlled checkout and verifies payment through its private capability without any signing RPC", async () => {
  commerce();
  const created = await POST(
    previewRequest("requests", {
      description: "Merchant item",
      amountZat: 100000,
    }),
  );
  expect(created.status).toBe(200);
  const { id, token } = await created.json();
  const prepared = await POST(customerRequest("prepare", token, { route }));
  expect(prepared.status).toBe(200);
  const details = await prepared.json();
  expect(details).toMatchObject({
    destination,
    amountZat: 100000,
    network: "mainnet",
  });
  const uri = new URL(details.uri);
  expect(uri.searchParams.get("amount")).toBe("0.00100000");
  expect(
    Buffer.from(uri.searchParams.get("memo")!, "base64url").toString(),
  ).toBe(details.memo);
  expect(details.memo).toContain(store.checkout(id)!.order);
  expect(store.merchant(merchant)!.wallet).toBe("");
  expect(store.merchant(merchant)!.destination).toBe("");
  const proof = await POST(
    customerRequest("payment-check", token, {
      txid: paymentTx,
      pool: "ironwood",
    }),
  );
  expect(proof.status).toBe(200);
  expect((await proof.json()).receipt).toMatchObject({
    network: "mainnet",
    paymentStatus: "confirmed",
    paymentTxid: paymentTx,
  });
  expect(
    requests.every((r) =>
      [
        "getwalletstatus",
        "z_listunifiedreceivers",
        "nostos_verify_output",
      ].includes(r.method),
    ),
  ).toBe(true);
});
it("holds payment creation when either commerce flag is absent or the wallet is syncing", async () => {
  commerce();
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "no");
  expect(
    (
      await POST(
        previewRequest("requests", { description: "Item", amountZat: 1000 }),
      )
    ).status,
  ).toBe(409);
  expect(requests).toHaveLength(0);
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS", "yes");
  transform = (p) => ({ ...p, locked: true });
  expect(
    (
      await POST(
        previewRequest("requests", { description: "Item", amountZat: 1000 }),
      )
    ).status,
  ).toBe(503);
  expect(store.requests(merchant)).toHaveLength(0);
});
it("does not replace the attached return route and rejects capability or expectation injection", async () => {
  commerce();
  const c = checkout();
  const token = store.receiptToken(c.id, merchant)!;
  expect(
    (
      await POST(
        customerRequest("prepare", token, { route: "u1" + "z".repeat(60) }),
      )
    ).status,
  ).toBe(503);
  expect(store.checkout(c.id)!.route).toBe(route);
  requests = [];
  expect(
    (
      await POST(
        customerRequest("payment-check", "x".repeat(43), {
          txid: paymentTx,
          pool: "ironwood",
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await POST(
        customerRequest("payment-check", token, {
          txid: paymentTx,
          pool: "ironwood",
          amountZat: 1,
        }),
      )
    ).status,
  ).toBe(400);
  expect(requests).toHaveLength(0);
});
it("saves approval without sending, claims once with password and verifies a manually signed refund", async () => {
  commerce();
  const c = await paid();
  const id = randomUUID();
  store.createRefundRequest(c.id, id, 40000, "Customer reason");
  requests = [];
  const decision = {
    requestId: id,
    decision: "approve",
    amountZat: 40000,
    reason: "Merchant approved",
  };
  expect((await POST(previewRequest("refund-decision", decision))).status).toBe(
    200,
  );
  expect((await POST(previewRequest("refund-decision", decision))).status).toBe(
    200,
  );
  expect(requests).toHaveLength(0);
  expect(core.refundTotals(paymentTx).reservedZat).toBe(0);
  const review = await POST(previewRequest("refund-review", { requestId: id }));
  expect(review.status).toBe(200);
  expect((await review.json()).handoffStarted).toBe(false);
  expect(
    (
      await POST(
        previewRequest("refund-handoff", {
          requestId: id,
          password: "incorrect",
        }),
      )
    ).status,
  ).toBe(403);
  const handoff = await POST(
    previewRequest("refund-handoff", {
      requestId: id,
      password: "test-password-long",
    }),
  );
  expect(handoff.status).toBe(200);
  const instruction = await handoff.json();
  expect(instruction).toMatchObject({
    recipient: route,
    amountZat: 40000,
    feeCapZat: 10000,
    requiresWalletApproval: true,
  });
  expect(new URL(instruction.uri).searchParams.get("amount")).toBe(
    "0.00040000",
  );
  expect(
    (
      await POST(
        previewRequest("refund-handoff", {
          requestId: id,
          password: "test-password-long",
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await POST(
        previewRequest("refund-candidate", { requestId: id, txid: refundTx }),
      )
    ).status,
  ).toBe(200);
  expect(core.refundTotals(paymentTx).refundedZat).toBe(0);
  expect(
    (await POST(previewRequest("refund-check", { requestId: id }))).status,
  ).toBe(200);
  expect(core.refundTotals(paymentTx)).toMatchObject({
    refundedZat: 40000,
    reservedZat: 0,
  });
  expect(store.refundRequest(id)?.status).toBe("settled");
  expect(
    requests.every((r) =>
      [
        "getwalletstatus",
        "z_listunifiedreceivers",
        "nostos_verify_output",
      ].includes(r.method),
    ),
  ).toBe(true);
});
it("rejects refund ownership, unknown fields, excessive approvals and changed decisions", async () => {
  commerce();
  const c = await paid();
  const id = randomUUID();
  store.createRefundRequest(c.id, id, 40000, "Customer reason");
  const other = store.signup("other@example.com", "long-other-password").id;
  store.db
    .prepare("UPDATE merchants SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), other);
  requests = [];
  expect(
    (
      await POST(
        previewRequest("refund-review", { requestId: id }, { actor: other }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await POST(
        previewRequest("refund-review", {
          requestId: id,
          recipient: destination,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await POST(
        previewRequest("refund-decision", {
          requestId: id,
          decision: "approve",
          amountZat: 40001,
          reason: "Approved reason",
        }),
      )
    ).status,
  ).toBe(503);
  expect(
    (
      await POST(
        previewRequest("refund-decision", {
          requestId: id,
          decision: "decline",
          reason: "Declined reason",
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await POST(
        previewRequest("refund-decision", {
          requestId: id,
          decision: "approve",
          amountZat: 40000,
          reason: "Approved reason",
        }),
      )
    ).status,
  ).toBe(503);
  expect(requests).toHaveLength(0);
});

it("automatically verifies saved incoming candidates without a customer transaction reference", async () => {
  const c = checkout();
  await detectObservedPayment(store, core, c.id);
  expect(store.checkout(c.id)?.paymentTxid).toBe(paymentTx);
  await detectObservedPayment(store, core, c.id);
  expect(
    requests.filter((r) => r.method === "nostos_incoming_candidates"),
  ).toHaveLength(1);
});
it("revisits delayed candidates after an unresolved scan without credit", async () => {
  const c = checkout();
  transform = (p) =>
    p.nostos_output_proof_v1 ? { ...p, exact_match: false } : p;
  await detectObservedPayment(store, core, c.id);
  expect(store.checkout(c.id)?.paymentTxid).toBeFalsy();
  transform = (p) => p;
  await detectObservedPayment(store, core, c.id);
  expect(store.checkout(c.id)?.paymentTxid).toBe(paymentTx);
});
it("rejects malformed candidate batches before output verification", async () => {
  const c = checkout();
  transform = (p) =>
    p.candidates ? { ...p, candidates: [[1, "invalid"]] } : p;
  await expect(detectObservedPayment(store, core, c.id)).rejects.toThrow();
  expect(requests.some((r) => r.method === "nostos_verify_output")).toBe(false);
});

it("freezes a merchant-selected refund fee limit before wallet handoff", async () => {
  const c = await paid();
  const id = approve(c.id);
  const review = await prepareObservedRefund(store, core, merchant, id, 25000);
  expect(review.feeCapZat).toBe(25000);
  await expect(
    prepareObservedRefund(store, core, merchant, id, 30000),
  ).rejects.toThrow();
  expect(core.refundTotals(paymentTx).reservedZat).toBe(40000);
});
