import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductStore, accountHeader, type Merchant } from "./product-store.js";
import { coreStore } from "./product-service.js";
import {
  merchantFunds,
  quoteWithdrawal,
  confirmWithdrawal,
} from "./merchant-funds.js";
import type { WalletRpc } from "./wallet-runtime.js";
import { GET, POST } from "../app/api/product/[...action]/route.js";
let dir: string,
  store: ProductStore,
  core: ReturnType<typeof coreStore>,
  m: Merchant,
  rpc: WalletRpc,
  node: Pick<WalletRpc, "call">;
const address = "utest1" + "a".repeat(60),
  dest = "utest1" + "b".repeat(60),
  txid = "c".repeat(64),
  outTx = "d".repeat(64),
  blockhash = "e".repeat(64);
let balance: number,
  inspection: Record<string, unknown>,
  failMethod: string,
  calls: string[],
  sendWait: (() => void) | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nostos-funds-"));
  vi.stubEnv("NOSTOS_NETWORK", "testnet");
  vi.stubEnv("NOSTOS_PRODUCT_DATABASE_PATH", join(dir, "accounts.sqlite"));
  vi.stubEnv("NOSTOS_PRODUCT_CORE_DATABASE_PATH", join(dir, "payments.sqlite"));
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "a".repeat(64));
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  store = new ProductStore();
  core = coreStore(store);
  m = store.signup("funds@example.com", "long-test-password");
  store.db
    .prepare("UPDATE merchants SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), m.id);
  store.finishSetup(m.id, "Store", "account", address);
  m = store.merchant(m.id)!;
  balance = 2000000;
  calls = [];
  failMethod = "";
  sendWait = undefined;
  inspection = {
    wallet_created: true,
    privacy_policy: "FullPrivacy",
    fee_zat: 10000,
    expiry_height: 140,
    transparent: { inputs: [], outputs: [] },
    sapling: { spends: 0, outputs: [] },
    orchard: { outputs: [{ user_address: dest, value_zat: 500000 }, {}] },
    ironwood: { outputs: [] },
  };
  rpc = {
    call: async <T>(method: string) => {
      calls.push(method);
      if (method === failMethod) throw new Error("private-wallet-data");
      if (method === "getwalletstatus")
        return {
          locked: false,
          node_tip: { height: 100, blockhash },
          wallet_tip: { height: 100, blockhash },
          fully_synced_height: 100,
        } as T;
      if (
        method === "pczt_create" ||
        method === "pczt_prove" ||
        method === "pczt_sign"
      )
        return {
          pczt: "private-unsigned-bytes",
          privacy_policy: "FullPrivacy",
        } as T;
      if (method === "pczt_inspect") return structuredClone(inspection) as T;
      if (method === "pczt_extract") {
        if (sendWait)
          await new Promise<void>((resolve) => {
            sendWait = resolve;
          });
        return { stored: true, txid: outTx, hex: "abcdef" } as T;
      }
      throw new Error(method);
    },
    decodeUnifiedAddress: async (a) => ({ orchard: a }),
    spendableShieldedBalanceZat: async () => balance,
    viewTransaction: async (id) => ({
      txid: id,
      confirmations: 2,
      outputs: [
        { outgoing: true, pool: "ironwood", valueZat: 500000, address: dest },
      ],
    }),
  };
  node = {
    call: async <T>(method: string) => {
      calls.push(method);
      if (method === failMethod) throw new Error("private-node-data");
      return (
        method === "getblockchaininfo"
          ? { chain: "test", blocks: 100, bestblockhash: blockhash }
          : outTx
      ) as T;
    },
  };
});
afterEach(() => {
  core.close();
  store.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
function paid(expired = true, amount = 1000000, id = txid) {
  const c = store.createRequest(
    m.id,
    "Order",
    "n_" + "1".repeat(32),
    amount,
  ).checkout;
  store.setRoute(c.id, address);
  store.recordPayment(c.id, id);
  store.paid(c.id);
  store.db
    .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
    .run(expired ? "2026-01-01T00:00:00Z" : null, c.id);
  core.insertPayment({
    id,
    merchantId: m.id,
    orderReference: c.order,
    paymentTxId: id,
    amountZat: amount,
    refundAddress: address,
    confirmations: 2,
    status: "confirmed",
  });
  return store.checkout(c.id)!;
}
function reserveRefund(id = txid) {
  return core.prepareRefund(
    id,
    {
      id: "refund-one",
      paymentId: id,
      idempotencyKey: "refund-one",
      amountZat: 100000,
    },
    true,
  );
}
async function quote() {
  return quoteWithdrawal(store, core, m, dest, 500000, rpc, node);
}
describe("merchant funds and audited withdrawal", () => {
  it("preserves legacy no-deadline principal and adds fee allowance", async () => {
    paid(false, 200000);
    balance = 190000;
    const f = await merchantFunds(store, core, m, rpc, node);
    expect(f.reservedForRefundsZat).toBe(200000);
    expect(f.fundingShortfallZat).toBe(20000);
    expect(f.withdrawableBeforeFeeZat).toBe(0);
    expect(calls).not.toContain("pczt_create");
  });
  it("excludes unindexed deposits from released earnings", async () => {
    expect(
      (await merchantFunds(store, core, m, rpc, node)).withdrawableBeforeFeeZat,
    ).toBe(0);
    paid();
    expect(
      (await merchantFunds(store, core, m, rpc, node)).withdrawableBeforeFeeZat,
    ).toBe(1000000);
  });
  it("keeps expired payment principal reserved while a customer request is open", async () => {
    const c = paid(false);
    store.createRefundRequest(
      c.id,
      "11111111-1111-1111-1111-111111111111",
      100000,
      "Refund please",
    );
    store.db
      .prepare("UPDATE checkouts SET refund_expires_at=? WHERE id=?")
      .run("2026-01-01T00:00:00Z", c.id);
    expect(
      (await merchantFunds(store, core, m, rpc, node)).reservedForRefundsZat,
    ).toBe(1000000);
  });
  it("does not release a missing route before the refund deadline", async () => {
    const c = paid(false);
    store.db.prepare("UPDATE checkouts SET route='' WHERE id=?").run(c.id);
    expect(
      (await merchantFunds(store, core, m, rpc, node)).withdrawableBeforeFeeZat,
    ).toBe(0);
  });
  it("quotes exact fee without signing or sending and encrypts its private fields", async () => {
    paid();
    const q = await quote();
    expect(q.feeZat).toBe(10000);
    expect(q.status).toBe("review");
    expect(calls).not.toContain("pczt_sign");
    expect(calls).not.toContain("sendrawtransaction");
    const row = core
      .withdrawalDatabase()
      .prepare("SELECT destination,pczt FROM merchant_withdrawals")
      .get()!;
    expect(row.destination).not.toContain(dest);
    expect(row.pczt).not.toContain("private-unsigned-bytes");
    expect(JSON.stringify(q)).not.toContain("private-unsigned-bytes");
  });
  it("subtracts actual fee from availability before accepting a quote", async () => {
    paid(true, 505000);
    await expect(quote()).rejects.toThrow();
    expect(
      core
        .withdrawalDatabase()
        .prepare("SELECT COUNT(*) AS n FROM merchant_withdrawals")
        .get()!.n,
    ).toBe(0);
  });
  it("rejects mixed-network or transparent addresses before transaction creation", async () => {
    paid();
    for (const d of ["u1" + "b".repeat(60), "t1" + "b".repeat(60)])
      await expect(
        quoteWithdrawal(store, core, m, d, 500000, rpc, node),
      ).rejects.toThrow();
    expect(calls).not.toContain("pczt_create");
  });
  it("rejects a proposal with transparent inputs or an altered recipient", async () => {
    paid();
    inspection.transparent = { inputs: [{}], outputs: [] };
    await expect(quote()).rejects.toThrow();
    inspection.transparent = { inputs: [], outputs: [] };
    inspection.orchard = {
      outputs: [{ value_zat: 500000, user_address: address }],
    };
    await expect(quote()).rejects.toThrow();
    expect(calls).not.toContain("pczt_sign");
  });
  it("sends the reviewed transaction once and replay only returns its record", async () => {
    paid();
    const q = await quote();
    const sent = await confirmWithdrawal(store, core, m, q.id, rpc, node);
    expect(sent.status).toBe("broadcast");
    expect(sent.txid).toBe(outTx);
    await confirmWithdrawal(store, core, m, q.id, rpc, node);
    expect(calls.filter((x) => x === "sendrawtransaction")).toHaveLength(1);
    expect(core.merchantWithdrawalInProgress(m.id)).toBe(true);
    const f = await merchantFunds(store, core, m, rpc, node);
    expect(f.history[0]!.status).toBe("confirmed");
    expect(f.withdrawableBeforeFeeZat).toBe(490000);
  });
  it("blocks refund preparation while a withdrawal is being extracted", async () => {
    paid();
    const q = await quote();
    sendWait = () => {};
    const pending = confirmWithdrawal(store, core, m, q.id, rpc, node);
    for (let n = 0; n < 50 && !calls.includes("pczt_extract"); n++)
      await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain("pczt_extract");
    expect(() => reserveRefund()).toThrow(/withdrawal/i);
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow();
    sendWait!();
    await pending;
    expect(calls.filter((x) => x === "sendrawtransaction")).toHaveLength(1);
  });
  it("blocks withdrawal if a refund is prepared after review", async () => {
    paid();
    const q = await quote();
    reserveRefund();
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow();
    expect(calls).not.toContain("pczt_sign");
  });
  it("holds an unknown send durably and can confirm only its saved txid without resend", async () => {
    paid();
    const q = await quote();
    failMethod = "sendrawtransaction";
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow(/reconciliation/);
    expect(core.merchantWithdrawalInProgress(m.id)).toBe(true);
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow();
    core.close();
    core = coreStore(store);
    expect(core.merchantWithdrawalInProgress(m.id)).toBe(true);
    failMethod = "";
    expect(
      (await merchantFunds(store, core, m, rpc, node)).history[0]!.status,
    ).toBe("confirmed");
    expect(calls.filter((x) => x === "sendrawtransaction")).toHaveLength(1);
  });
  it("does not clear a null-txid failure or leak wallet errors", async () => {
    paid();
    const q = await quote();
    failMethod = "pczt_prove";
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow("Withdrawal outcome needs reconciliation");
    expect(
      (await merchantFunds(store, core, m, rpc, node)).spendingBlocked,
    ).toBe(true);
    expect(calls).not.toContain("sendrawtransaction");
  });
  it("rejects expired review and fee changes before signing", async () => {
    paid();
    const q = await quote();
    inspection.fee_zat = 20000;
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow();
    inspection.fee_zat = 10000;
    core
      .withdrawalDatabase()
      .prepare("UPDATE merchant_withdrawals SET expires_at=0")
      .run();
    await expect(
      confirmWithdrawal(store, core, m, q.id, rpc, node),
    ).rejects.toThrow();
    expect(calls).not.toContain("pczt_sign");
  });
  it("cannot confirm another merchant's review", async () => {
    paid();
    const q = await quote();
    const other = store.signup("other@example.com", "long-test-password");
    await expect(
      confirmWithdrawal(store, core, other, q.id, rpc, node),
    ).rejects.toThrow();
    expect(calls).not.toContain("pczt_sign");
  });
  it("requires auth, same origin and current password at HTTP spend boundaries", async () => {
    const cookie = accountHeader(store.session(m.id)).split(";")[0]!;
    const request = (
      body: unknown,
      origin = "https://nostos.example",
      auth = cookie,
    ) =>
      new Request("https://nostos.example/api/product/withdrawal-confirm", {
        method: "POST",
        headers: { cookie: auth, origin },
        body: JSON.stringify(body),
      });
    expect((await POST(request({}, "https://evil.example"))).status).toBe(403);
    expect((await POST(request({}, undefined, ""))).status).toBe(401);
    expect(
      (await POST(request({ id: "1".repeat(36), password: "wrong" }))).status,
    ).toBe(403);
    expect(
      (await GET(new Request("https://nostos.example/api/product/funds")))
        .status,
    ).toBe(401);
  });
});
