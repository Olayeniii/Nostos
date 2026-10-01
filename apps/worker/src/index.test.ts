import { describe, expect, it } from "vitest";
import { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { encodeMemo } from "../../../packages/memo/src/index.js";
import { ingestMerchantPayments } from "./index.js";

const txid = "c".repeat(64);
const refundAddress = `utest1${"d".repeat(80)}`;

describe("merchant payment intake", () => {
  it("records a Nostos payment once across repeated scans", async () => {
    const store = new SqlitePaymentStore(":memory:");
    const source = {
      listUnspent: async () => [
        {
          txid,
          value: 0.02,
          confirmations: 4,
          memo: encodeMemo("order_001", refundAddress),
        },
      ],
    };

    const first = await ingestMerchantPayments({
      merchantId: "merchant_001",
      source,
      store,
    });
    const second = await ingestMerchantPayments({
      merchantId: "merchant_001",
      source,
      store,
    });

    expect(first).toMatchObject({ created: 1, observed: 1 });
    expect(second).toMatchObject({ created: 0, observed: 1 });
    expect(store.paymentCount()).toBe(1);
    expect(store.findByTxid(txid)).toMatchObject({
      amountZat: 2_000_000,
      orderReference: "order_001",
      status: "confirmed",
    });
    store.close();
  });

  it("ignores unrelated wallet notes", async () => {
    const store = new SqlitePaymentStore(":memory:");
    const result = await ingestMerchantPayments({
      merchantId: "merchant_001",
      source: {
        listUnspent: async () => [
          { txid: "e".repeat(64), value: 1, memoStr: "faucet memo" },
        ],
      },
      store,
    });
    expect(result).toMatchObject({ created: 0, observed: 0 });
    expect(store.paymentCount()).toBe(0);
    store.close();
  });
});
