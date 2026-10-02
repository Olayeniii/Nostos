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
      decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
      listUnspent: async () => [
        {
          txid,
          outgoing: false,
          pool: "orchard",
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
        decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
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

  it("recovers a spent payment from transaction history", async () => {
    const store = new SqlitePaymentStore(":memory:");
    const result = await ingestMerchantPayments({
      merchantId: "merchant_001",
      historicalTxids: [txid],
      source: {
        decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
        listUnspent: async () => [],
        viewTransaction: async () => ({
          txid,
          confirmations: 20,
          outputs: [
            {
              pool: "ironwood",
              outgoing: false,
              valueZat: 2_000_000,
              value: 0.02,
              memo: encodeMemo("order_001", refundAddress),
            },
          ],
        }),
      },
      store,
    });
    expect(result).toMatchObject({ created: 1, observed: 1 });
    expect(store.findByTxid(txid)).toMatchObject({ confirmations: 20 });
    store.close();
  });
});

it("skips malformed memos without blocking a subsequent valid note", async () => {
  const store = new SqlitePaymentStore(":memory:");
  const source = {
    decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
    listUnspent: async () => [
      {
        txid: "a".repeat(64),
        outgoing: false,
        pool: "orchard",
        memoStr: '{"p":"nostos",broken',
      },
      {
        txid,
        outgoing: false,
        pool: "orchard",
        value: 0.02,
        confirmations: 2,
        memo: encodeMemo("order", refundAddress),
      },
    ],
  };
  const result = await ingestMerchantPayments({
    store,
    source,
    merchantId: "merchant",
  });
  expect(result.created).toBe(1);
  expect(store.paymentCount()).toBe(1);
  store.close();
});
it("fails closed on a syntactically valid route without Orchard capability", async () => {
  const store = new SqlitePaymentStore(":memory:");
  await expect(
    ingestMerchantPayments({
      store,
      merchantId: "merchant",
      source: {
        decodeUnifiedAddress: async () => ({ sapling: "zs1fake" }),
        listUnspent: async () => [
          {
            txid,
            outgoing: false,
            pool: "orchard",
            value: 0.02,
            confirmations: 2,
            memo: encodeMemo("order", refundAddress),
          },
        ],
      },
    }),
  ).rejects.toThrow("Orchard-only");
  expect(store.paymentCount()).toBe(0);
  store.close();
});
