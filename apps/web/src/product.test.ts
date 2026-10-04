import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductStore, accountHeader } from "./product-store.js";
import {
  coreStore,
  newRequest,
  preparePayment,
  reconcile,
  refundPayment,
  checkoutView,
  type ProductWallet,
} from "./product-service.js";
import { encodeMemo } from "../../../packages/memo/src/index.js";
import { GET, POST } from "../app/api/product/[...action]/route.js";
let directory: string, store: ProductStore, core: ReturnType<typeof coreStore>;
const destination = "utest1" + "a".repeat(60),
  route = "utest1" + "b".repeat(60),
  txid = "c".repeat(64),
  refundTxid = "d".repeat(64);
let rpc: ProductWallet;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nostos-product-"));
  vi.stubEnv(
    "NOSTOS_PRODUCT_DATABASE_PATH",
    join(directory, "accounts.sqlite"),
  );
  vi.stubEnv(
    "NOSTOS_PRODUCT_CORE_DATABASE_PATH",
    join(directory, "payments.sqlite"),
  );
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "e".repeat(64));
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  store = new ProductStore();
  core = coreStore(store);
  rpc = {
    createAccount: vi.fn(async () => "wallet-uuid"),
    deriveOrchardAddress: vi.fn(async () => destination),
    decodeUnifiedAddress: vi.fn(async (address: string) => ({
      orchard: address,
    })),
    listUnspent: vi.fn(async () => []),
    viewTransaction: vi.fn(async () => ({
      txid,
      confirmations: 2,
      outputs: [],
    })),
    sendFromAccount: vi.fn(async () => refundTxid),
  };
});
afterEach(() => {
  core.close();
  store.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function merchant(email = "one@example.com") {
  const m = store.signup(email, "long-password-for-tests");
  store.finishSetup(m.id, "One Store", "wallet-uuid", destination);
  return store.merchant(m.id)!;
}
function request(
  path: string,
  body: unknown,
  cookie = "",
  origin = "https://nostos.example",
) {
  return new Request("https://nostos.example/api/product/" + path, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
describe("merchant accounts and private storage", () => {
  it("authenticates one owner, expires and revokes sessions", () => {
    const m = merchant();
    const token = store.session(m.id);
    const req = new Request("https://nostos.example", {
      headers: { cookie: accountHeader(token).split(";")[0]! },
    });
    expect(store.authenticate(req)?.id).toBe(m.id);
    expect(store.login(m.email, "wrong-password")).toBeUndefined();
    expect(store.login(m.email, "long-password-for-tests")?.id).toBe(m.id);
    store.logout(req);
    expect(store.authenticate(req)).toBeUndefined();
    const expired = store.session(m.id);
    store.db.prepare("UPDATE account_sessions SET expires_at=0").run();
    expect(
      store.authenticate(
        new Request("https://nostos.example", {
          headers: { cookie: accountHeader(expired).split(";")[0]! },
        }),
      ),
    ).toBeUndefined();
  });
  it("encrypts identities, route, memo metadata and capabilities at rest", async () => {
    const m = merchant();
    const created = newRequest(store, m, "Private order detail", 1000000);
    const c = store.checkout(created.id)!;
    await preparePayment(store, c, route, rpc);
    expect(store.byToken(created.token)?.route).toBe(route);
    expect(store.receiptToken(c.id, m.id)).toBe(created.token);
    expect(
      store.receiptToken(c.id, merchant("two@example.com").id),
    ).toBeUndefined();
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const raw = readFileSync(join(directory, "accounts.sqlite")).toString();
    for (const secret of [
      m.email,
      m.name,
      m.wallet,
      destination,
      route,
      "Private order detail",
      c.order,
      created.token,
    ])
      expect(raw).not.toContain(secret);
    const encrypted = store.encrypt(route);
    expect(() => store.decrypt(encrypted.slice(0, -2) + "AA")).toThrow();
  });
  it("preserves an interrupted setup marker without creating another account", () => {
    const m = store.signup("pending@example.com", "long-password-for-tests");
    expect(store.claimSetup(m.id)).toBe(true);
    expect(store.merchant(m.id)?.wallet).toBe("provisioning");
    expect(store.claimSetup(m.id)).toBe(false);
  });
  it("rejects wrong origin and anonymous merchant operations", async () => {
    expect(
      (await POST(request("requests", { amountZat: 1, description: "Test" })))
        .status,
    ).toBe(401);
    expect(
      (
        await POST(
          request(
            "signup",
            { email: "a@example.com", password: "long-password-for-tests" },
            "",
            "https://evil.example",
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("does not accept an account cookie as a customer capability", async () => {
    const m = merchant();
    const cookie = accountHeader(store.session(m.id)).split(";")[0]!;
    expect(
      (
        await GET(
          new Request("https://nostos.example/api/product/checkout", {
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(401);
  });
});
describe("verified shielded intake and refund ownership", () => {
  it("prepares a ZIP 321 request and blocks return-route replacement or reuse", async () => {
    const m = merchant();
    const first = newRequest(store, m, "Order one", 1000000);
    const c = store.checkout(first.id)!;
    const prepared = await preparePayment(store, c, route, rpc);
    expect(prepared.uri).toContain("amount=0.01000000&memo=");
    expect(
      Buffer.from(prepared.uri.split("&memo=")[1]!, "base64url").toString(),
    ).toBe(prepared.memo);
    await expect(
      preparePayment(
        store,
        store.checkout(c.id)!,
        "utest1" + "f".repeat(60),
        rpc,
      ),
    ).rejects.toThrow();
    const second = newRequest(store, m, "Order two", 1000000);
    await expect(
      preparePayment(store, store.checkout(second.id)!, route, rpc),
    ).rejects.toThrow();
  });
  it.each(["orchard", "sapling", "ironwood"])(
    "requires the exact incoming %s note and memo before authorizing a refund",
    async (pool) => {
      const m = merchant();
      const first = newRequest(store, m, "Order one", 1000000);
      await preparePayment(store, store.checkout(first.id)!, route, rpc);
      const c = store.checkout(first.id)!;
      const good = {
        txid,
        address: destination,
        valueZat: 1000000,
        outgoing: false,
        pool,
        memo: encodeMemo(c.order, route),
      };
      for (const bad of [
        { ...good, outgoing: true },
        { ...good, valueZat: 999999 },
        { ...good, address: route },
        { ...good, pool: "transparent" },
        { ...good, pool: "unknown" },
        { ...good, pool: "" },
        { ...good, memo: encodeMemo("different", route) },
      ]) {
        vi.mocked(rpc.listUnspent).mockResolvedValue([bad]);
        vi.mocked(rpc.viewTransaction).mockResolvedValue({
          txid,
          confirmations: 2,
          outputs: [bad],
        });
        await reconcile(store, core, c, rpc);
        expect(core.paymentCount()).toBe(0);
      }
      vi.mocked(rpc.listUnspent).mockResolvedValue([good]);
      vi.mocked(rpc.viewTransaction).mockResolvedValue({
        txid,
        confirmations: 2,
        outputs: [good],
      });
      await reconcile(store, core, c, rpc);
      expect(core.paymentCount()).toBe(1);
      expect(store.checkout(c.id)?.status).toBe("confirmed");
      const other = merchant("outsider@example.com");
      await expect(
        refundPayment(store, core, other, c.id, 300000, rpc),
      ).rejects.toThrow();
      expect(rpc.sendFromAccount).not.toHaveBeenCalled();
      await refundPayment(store, core, m, c.id, 300000, rpc);
      await refundPayment(store, core, m, c.id, 300000, rpc);
      expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
      expect(rpc.sendFromAccount).toHaveBeenCalledWith(m.wallet, "orchard", [
        { address: route, amount: 0.003 },
      ]);
      const view = checkoutView(store, core, store.checkout(c.id)!);
      expect(JSON.stringify(view)).not.toContain(route);
      expect(view.refundAmountZat).toBe(300000);
      expect(view).not.toHaveProperty("payment");
      core.close();
      core = coreStore(store);
      expect(core.findByTxid(txid)?.refundAddress).toBe(route);
      const raw = readFileSync(join(directory, "payments.sqlite")).toString();
      expect(raw).not.toContain(route);
      expect(raw).not.toContain(c.order);
    },
  );
  it("blocks another send after an uncertain wallet response", async () => {
    const m = merchant();
    const created = newRequest(store, m, "Unknown send", 1000000);
    await preparePayment(store, store.checkout(created.id)!, route, rpc);
    store.recordPayment(created.id, txid);
    store.paid(created.id);
    core.insertPayment({
      id: txid,
      merchantId: m.id,
      orderReference: store.checkout(created.id)!.order,
      paymentTxId: txid,
      amountZat: 1000000,
      refundAddress: route,
      confirmations: 2,
      status: "confirmed",
    });
    vi.mocked(rpc.sendFromAccount).mockRejectedValue(
      new Error("connection lost"),
    );
    await expect(
      refundPayment(store, core, m, created.id, 300000, rpc),
    ).rejects.toThrow();
    await expect(
      refundPayment(store, core, m, created.id, 300000, rpc),
    ).rejects.toThrow();
    expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
    expect(core.findRefundByPayment(txid)?.status).toBe("broadcast_unknown");
  });
});

describe("protocol rejection and route retirement", () => {
  it("rejects a mixed route before persisting or preparing a payment", async () => {
    const m = merchant();
    const created = newRequest(store, m, "Mixed route", 1000000);
    vi.mocked(rpc.decodeUnifiedAddress).mockResolvedValue({
      orchard: route,
      p2pkh: "t1fake",
    });
    await expect(
      preparePayment(store, store.checkout(created.id)!, route, rpc),
    ).rejects.toThrow();
    expect(store.checkout(created.id)?.route).toBe("");
    expect(rpc.sendFromAccount).not.toHaveBeenCalled();
  });
  it.each(["orchard", "ironwood"])(
    "retires routes after %s refund confirmation and blocks another send",
    async (pool) => {
      const m = merchant();
      const created = newRequest(store, m, "Retirement", 1000000);
      await preparePayment(store, store.checkout(created.id)!, route, rpc);
      const c = store.checkout(created.id)!;
      const incoming = {
        txid,
        outgoing: false,
        address: destination,
        pool,
        valueZat: 1000000,
        memo: encodeMemo(c.order, route),
      };
      vi.mocked(rpc.listUnspent).mockResolvedValue([incoming]);
      vi.mocked(rpc.viewTransaction).mockImplementation(async (id) => ({
        txid: id,
        confirmations: id === txid ? 2 : 0,
        outputs:
          id === txid
            ? [incoming]
            : [
                {
                  outgoing: true,
                  address: route,
                  pool,
                  valueZat: 1000000,
                },
              ],
      }));
      await reconcile(store, core, c, rpc);
      await refundPayment(store, core, m, c.id, 1000000, rpc);
      await reconcile(store, core, store.checkout(c.id)!, rpc);
      expect(store.checkout(c.id)?.route).toBe(route);
      expect(() => core.retireConfirmedRefundRoute(txid)).toThrow();
      vi.mocked(rpc.viewTransaction).mockImplementation(async (id) => ({
        txid: id,
        confirmations: 2,
        outputs:
          id === txid
            ? [incoming]
            : [
                {
                  outgoing: true,
                  address: route,
                  pool,
                  valueZat: 1000000,
                },
              ],
      }));
      await reconcile(store, core, store.checkout(c.id)!, rpc);
      expect(store.checkout(c.id)?.route).toBe("");
      expect(core.findByTxid(txid)).toMatchObject({
        refundAddress: "",
        status: "refunded",
      });
      expect(checkoutView(store, core, store.checkout(c.id)!)).toMatchObject({
        status: "confirmed",
        refundTxid,
        refundAmountZat: 1000000,
        paymentConfirmations: 2,
      });
      await expect(
        refundPayment(store, core, m, c.id, 1000000, rpc),
      ).resolves.toMatchObject({ broadcast: false, txid: refundTxid });
      expect(rpc.sendFromAccount).toHaveBeenCalledTimes(1);
      core.close();
      core = coreStore(store);
      await reconcile(store, core, store.checkout(c.id)!, rpc);
      expect(core.findByTxid(txid)?.refundAddress).toBe("");
    },
  );
});

it("puts only the Orchard receiver from a combined shielded UA in the paying memo", async () => {
  const m = merchant();
  const created = newRequest(store, m, "Noir route", 1000000);
  const mixed = "utest1" + "f".repeat(80);
  vi.mocked(rpc.decodeUnifiedAddress).mockImplementation(
    async (address): Promise<Record<string, string>> =>
      address === mixed
        ? { orchard: route, sapling: "zs1fixture" }
        : { orchard: address },
  );
  const first = await preparePayment(
    store,
    store.checkout(created.id)!,
    mixed,
    rpc,
  );
  expect(JSON.parse(first.memo).r).toBe(route);
  expect(first.memo).not.toContain(mixed);
  expect(first.uri).not.toContain("message=");
  expect(store.checkout(created.id)?.route).toBe(route);
  const repeated = await preparePayment(
    store,
    store.checkout(created.id)!,
    mixed,
    rpc,
  );
  expect(repeated.memo).toBe(first.memo);
  const second = newRequest(store, m, "Same receiver", 1000000);
  await expect(
    preparePayment(store, store.checkout(second.id)!, route, rpc),
  ).rejects.toThrow();
});

describe("live wallet note representation", () => {
  it.each([false, true])(
    "matches equivalent Orchard receivers with unspent direction absent, reject=%s",
    async (reject) => {
      const m = merchant();
      const created = newRequest(store, m, "Receiver representation", 1000000);
      await preparePayment(store, store.checkout(created.id)!, route, rpc);
      const c = store.checkout(created.id)!;
      const alias = "utest1" + "z".repeat(60);
      vi.mocked(rpc.decodeUnifiedAddress).mockImplementation(
        async (address): Promise<Record<string, string>> => ({
          orchard: address === alias && !reject ? destination : address,
        }),
      );
      const note = {
        txid,
        address: alias,
        pool: "ironwood",
        valueZat: 1000000,
        memo: encodeMemo(c.order, route),
      };
      vi.mocked(rpc.listUnspent).mockResolvedValue([note]);
      vi.mocked(rpc.viewTransaction).mockResolvedValue({
        txid,
        confirmations: 2,
        outputs: [{ ...note, outgoing: false }],
      });
      await reconcile(store, core, c, rpc);
      expect(core.paymentCount()).toBe(reject ? 0 : 1);
    },
  );
  it("does not infer incoming direction from a transaction output with no direction", async () => {
    const m = merchant();
    const created = newRequest(store, m, "Missing direction", 1000000);
    await preparePayment(store, store.checkout(created.id)!, route, rpc);
    const c = store.checkout(created.id)!;
    const note = {
      txid,
      address: destination,
      pool: "ironwood",
      valueZat: 1000000,
      memo: encodeMemo(c.order, route),
    };
    vi.mocked(rpc.listUnspent).mockResolvedValue([note]);
    vi.mocked(rpc.viewTransaction).mockResolvedValue({
      txid,
      confirmations: 2,
      outputs: [note],
    });
    await reconcile(store, core, c, rpc);
    expect(core.paymentCount()).toBe(0);
  });
});
