import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { SqlitePaymentStore } from "../../../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../../../packages/zcash-adapter/src/index.js";
import { GET } from "./payments/route.js";
import { POST } from "./refunds/route.js";
import { requestJson, hasRecordedRefund } from "../../src/requests.js";

const paymentId = "a".repeat(64);
const destination = `utest1${"b".repeat(80)}`;
let directory: string;
let store: SqlitePaymentStore;
let send: MockInstance<ZalletRpcClient["sendFromAccount"]>;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nostos-boundary-"));
  const path = join(directory, "fixture.sqlite");
  vi.stubEnv("NOSTOS_DATABASE_PATH", path);
  vi.stubEnv("NOSTOS_WEB_TOKEN", "fixture-access");
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://private.example");
  vi.stubEnv("NOSTOS_WEB_ALLOWED_PAYMENT_TXID", paymentId);
  vi.stubEnv("NOSTOS_MERCHANT_WALLET_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE", "/unused-fixture");
  vi.stubEnv("NOSTOS_MERCHANT_ACCOUNT_UUID", "fixture-account");
  vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_URL", "");
  vi.stubEnv("NOSTOS_CUSTOMER_WALLET_RPC_COOKIE_FILE", "");
  vi.spyOn(
    ZalletRpcClient.prototype,
    "decodeUnifiedAddress",
  ).mockImplementation(async (address) => ({ orchard: address }));
  send = vi
    .spyOn(ZalletRpcClient.prototype, "sendFromAccount")
    .mockRejectedValue(new Error(`fixture failure ${destination}`));
  store = new SqlitePaymentStore(path);
  store.insertPayment({
    id: paymentId,
    merchantId: "fixture-merchant",
    orderReference: "fixture-order",
    paymentTxId: paymentId,
    amountZat: 1000000,
    refundAddress: destination,
    confirmations: 3,
    status: "confirmed",
  });
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function request(body: unknown, origin = "https://private.example") {
  return new Request("http://localhost:3000/api/refunds", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-access",
      origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
describe("private HTTP boundary with isolated database", () => {
  it("requires access before returning payment data", async () => {
    const r = await GET(new Request("http://localhost/api/payments"));
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(destination);
    expect(send).not.toHaveBeenCalled();
  });
  it("returns masked destinations and disables other payment authorization", async () => {
    vi.stubEnv("NOSTOS_WEB_ALLOWED_PAYMENT_TXID", "c".repeat(64));
    const r = await GET(
      new Request("http://localhost/api/payments", {
        headers: { authorization: "Bearer fixture-access" },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const text = await r.text();
    expect(text).not.toContain(destination);
    expect(text).not.toContain("fixture-account");
    const data = JSON.parse(text);
    expect(data.payments[0].destination).toBe(
      `${destination.slice(0, 8)}...${destination.slice(-8)}`,
    );
    expect(data.payments[0].canRefund).toBe(false);
  });
  it("rejects untrusted origins without creating a refund", async () => {
    const r = await POST(
      request(
        { paymentTxid: paymentId, amountZat: 300000 },
        "https://other.example",
      ),
    );
    expect(r.status).toBe(403);
    expect(store.findRefundByPayment(paymentId)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects an unauthorized payment before wallet access", async () => {
    const r = await POST(
      request({ paymentTxid: "c".repeat(64), amountZat: 300000 }),
    );
    expect(r.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects zero amount without creating an instruction", async () => {
    const r = await POST(request({ paymentTxid: paymentId, amountZat: 0 }));
    expect(r.status).toBe(409);
    expect(store.findRefundByPayment(paymentId)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts wallet failure and blocks unknown send across requests", async () => {
    const body = { paymentTxid: paymentId, amountZat: 300000 };
    const first = await POST(request(body));
    expect(first.status).toBe(409);
    expect(await first.text()).not.toContain(destination);
    expect(store.findRefundByPayment(paymentId)?.status).toBe(
      "broadcast_unknown",
    );
    const second = await POST(request(body));
    expect(second.status).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.findRefundByPayment(paymentId)?.amountZat).toBe(300000);
  });
});

it("reconciles a lost response to the persisted txid without a second broadcast", async () => {
  const txid = "d".repeat(64);
  send.mockResolvedValue(txid);
  const body = { paymentTxid: paymentId, amountZat: 300000 };
  let serverFinished: Promise<Response> | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init: RequestInit) => {
      serverFinished = POST(request(JSON.parse(String(init.body))));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("Response lost")),
          { once: true },
        );
      });
    }),
  );
  const controller = new AbortController();
  const client = requestJson(
    "/api/refunds",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    1000,
    controller.signal,
  );
  const lost = expect(client).rejects.toThrow("Response lost");
  expect((await serverFinished)?.status).toBe(200);
  controller.abort();
  await lost;
  expect(store.findRefundByPayment(paymentId)).toMatchObject({
    txid,
    status: "broadcast",
    amountZat: 300000,
  });
  const read = await GET(
    new Request("http://localhost/api/payments", {
      headers: { authorization: "Bearer fixture-access" },
    }),
  );
  const data = await read.json();
  expect(hasRecordedRefund(data.payments[0])).toBe(true);
  expect(data.payments[0]).toMatchObject({
    refundTxid: txid,
    canRefund: false,
    availableZat: 700000,
  });
  const retry = await POST(request(body));
  expect(await retry.json()).toEqual({ broadcast: false, txid });
  expect(send).toHaveBeenCalledTimes(1);
});

it("contains legacy storage read errors without returning sensitive details", async () => {
  vi.spyOn(SqlitePaymentStore.prototype, "listPayments").mockImplementation(
    () => {
      throw new Error(`synthetic SQLite failure ${destination}`);
    },
  );
  const r = await GET(
    new Request("http://localhost/api/payments", {
      headers: { authorization: "Bearer fixture-access" },
    }),
  );
  expect(r.status).toBe(503);
  expect(r.headers.get("Cache-Control")).toBe("no-store");
  expect(await r.text()).not.toContain(destination);
});
