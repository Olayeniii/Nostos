import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqlitePaymentStore } from "../../../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../../../packages/zcash-adapter/src/index.js";
import { receiptToken } from "../../src/receipt-access.js";
import { GET as receipt } from "./receipt/route.js";
import { POST as issue } from "./receipts/route.js";
import { GET as payments } from "./payments/route.js";
import { POST as refund } from "./refunds/route.js";

const id = "a".repeat(64);
const other = "b".repeat(64);
const secret = "1".repeat(64);
const destination = `utest1${"c".repeat(80)}`;
let directory: string;
let store: SqlitePaymentStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nostos-receipt-"));
  vi.stubEnv("NOSTOS_DATABASE_PATH", join(directory, "fixture.sqlite"));
  vi.stubEnv("NOSTOS_RECEIPT_SECRET", secret);
  vi.stubEnv("NOSTOS_WEB_TOKEN", "fixture-merchant-access");
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://private.example");
  vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_URL", "");
  vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_COOKIE_FILE", "");
  store = new SqlitePaymentStore(process.env.NOSTOS_DATABASE_PATH!);
  for (const [paymentId, order] of [
    [id, "customer-one"],
    [other, "customer-two"],
  ]) {
    store.insertPayment({
      id: paymentId!,
      paymentTxId: paymentId!,
      merchantId: "fixture-merchant",
      orderReference: order!,
      amountZat: 1000000,
      refundAddress: destination,
      confirmations: 3,
      status: "confirmed",
    });
  }
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function read(token: string) {
  return new Request("http://localhost/api/receipt", {
    headers: { authorization: `Bearer ${token}` },
  });
}
function create(
  token = "fixture-merchant-access",
  origin = "https://private.example",
) {
  return new Request("http://localhost/api/receipts", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentTxid: id }),
  });
}
function prepare() {
  store.prepareRefund(id, {
    id: "fixture-refund",
    paymentId: id,
    idempotencyKey: "fixture-intent",
    amountZat: 300000,
  });
  store.claimRefundBroadcast(id);
  store.recordRefundBroadcast(id, "d".repeat(64));
}
describe("separate customer receipt access", () => {
  it("issues an opaque fragment link only to authenticated merchant and trusted origin", async () => {
    expect((await issue(create("wrong-access"))).status).toBe(401);
    expect(
      (await issue(create("fixture-merchant-access", "https://other.example")))
        .status,
    ).toBe(403);
    const response = await issue(create());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(id);
    expect(text).not.toContain(destination);
    expect(text).not.toContain(secret);
    expect(JSON.parse(text).receiptPath).toBe(
      `/receipt#${receiptToken(id, secret)}`,
    );
  });
  it("fails closed without a separate properly formed receipt key", async () => {
    vi.stubEnv("NOSTOS_RECEIPT_SECRET", "");
    expect((await issue(create())).status).toBe(503);
    expect((await receipt(read(receiptToken(id, secret)))).status).toBe(503);
  });
  it("never accepts merchant access or unknown receipt access for customer reads", async () => {
    expect((await receipt(read("fixture-merchant-access"))).status).toBe(401);
    expect((await receipt(read("z".repeat(43)))).status).toBe(401);
  });
  it("returns one payment only, without destination, merchant list or refund permission", async () => {
    prepare();
    store.confirmRefund(id);
    const response = await receipt(read(receiptToken(id, secret)));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    for (const privateValue of [
      destination,
      "customer-two",
      "canRefund",
      "fixture-merchant",
      "idempotencyKey",
      "payments",
    ])
      expect(text).not.toContain(privateValue);
    expect(JSON.parse(text).receipt).toMatchObject({
      orderReference: "customer-one",
      refundAmountZat: 300000,
      status: "confirmed",
    });
    expect(receiptToken(other, secret)).not.toBe(receiptToken(id, secret));
  });
  it("receipt access cannot read merchant payments, issue links or send refunds", async () => {
    const token = receiptToken(id, secret);
    expect(
      (
        await payments(
          new Request("http://localhost/api/payments", {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(401);
    expect((await issue(create(token))).status).toBe(401);
    expect(
      (
        await refund(
          new Request("http://localhost/api/refunds", {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              origin: "https://private.example",
            },
            body: JSON.stringify({ paymentTxid: id, amountZat: 300000 }),
          }),
        )
      ).status,
    ).toBe(401);
    expect(store.findRefundByPayment(id)).toBeUndefined();
  });
  it("key rotation revokes previously issued receipt access", async () => {
    const token = receiptToken(id, secret);
    vi.stubEnv("NOSTOS_RECEIPT_SECRET", "2".repeat(64));
    expect((await receipt(read(token))).status).toBe(401);
  });
  it("does not confirm a wallet output with the wrong amount", async () => {
    prepare();
    vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_URL", "http://127.0.0.1:1");
    vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_COOKIE_FILE", "/unused-fixture");
    const view = vi
      .spyOn(ZalletRpcClient.prototype, "viewTransaction")
      .mockResolvedValue({
        txid: "d".repeat(64),
        confirmations: 5,
        outputs: [{ address: destination, valueZat: 310000, outgoing: false }],
      });
    expect(
      (await (await receipt(read(receiptToken(id, secret)))).json()).receipt
        .status,
    ).toBe("broadcast");
    view.mockResolvedValue({
      txid: "d".repeat(64),
      confirmations: 5,
      outputs: [{ address: destination, valueZat: 300000, outgoing: false }],
    });
    expect(
      (await (await receipt(read(receiptToken(id, secret)))).json()).receipt
        .status,
    ).toBe("confirmed");
  });
});
