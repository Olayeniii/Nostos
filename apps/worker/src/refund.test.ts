import { describe, expect, it, vi } from "vitest";
import type { PaymentRecord } from "../../../packages/core/src/index.js";
import { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { executePartialRefund } from "./refund.js";

const payment: PaymentRecord = {
  id: "a".repeat(64),
  merchantId: "merchant_001",
  orderReference: "order_001",
  paymentTxId: "a".repeat(64),
  amountZat: 2_000_000,
  refundAddress: `utest1${"b".repeat(80)}`,
  confirmations: 3,
  status: "confirmed",
};

function storeWithPayment(): SqlitePaymentStore {
  const store = new SqlitePaymentStore(":memory:");
  store.insertPayment(payment);
  return store;
}

describe("partial refund execution", () => {
  it.each(["runtime", "ledger", "receiver"])(
    "holds mainnet hosted signing before wallet calls or reservation: %s",
    async (boundary) => {
      const store = new SqlitePaymentStore(":memory:");
      if (boundary === "ledger") store.bindNetwork("mainnet");
      store.insertPayment({
        ...payment,
        refundAddress:
          boundary === "receiver"
            ? `u1${"b".repeat(80)}`
            : payment.refundAddress,
      });
      vi.stubEnv(
        "NOSTOS_NETWORK",
        boundary === "runtime" ? "mainnet" : "testnet",
      );
      const broadcaster = {
        spendableShieldedBalanceZat: vi.fn(),
        decodeUnifiedAddress: vi.fn(),
        sendFromAccount: vi.fn(),
      };
      const authorizeBeforePrepare = vi.fn();
      try {
        await expect(
          executePartialRefund({
            store,
            broadcaster,
            merchantAccountUuid: "merchant-account",
            paymentTxid: payment.paymentTxId,
            amountZat: 500000,
            idempotencyKey: "held_refund",
            authorizeBeforePrepare,
          }),
        ).rejects.toThrow("Hosted refund signing is disabled on mainnet.");
        expect(broadcaster.decodeUnifiedAddress).not.toHaveBeenCalled();
        expect(broadcaster.spendableShieldedBalanceZat).not.toHaveBeenCalled();
        expect(broadcaster.sendFromAccount).not.toHaveBeenCalled();
        expect(authorizeBeforePrepare).not.toHaveBeenCalled();
        expect(store.findRefundByPayment(payment.id)).toBeUndefined();
      } finally {
        store.close();
        vi.unstubAllEnvs();
      }
    },
  );

  it("keeps an existing mainnet reservation intact when hosted execution is held", async () => {
    const store = new SqlitePaymentStore(":memory:");
    store.bindNetwork("mainnet");
    store.insertPayment(payment);
    store.prepareRefund(payment.paymentTxId, {
      id: "held",
      paymentId: payment.id,
      idempotencyKey: "held",
      amountZat: 500000,
    });
    store.claimRefundBroadcast(payment.id, "held");
    store.markRefundBroadcastUnknown(payment.id, "held");
    vi.stubEnv("NOSTOS_NETWORK", "testnet");
    const broadcaster = {
      spendableShieldedBalanceZat: vi.fn(),
      decodeUnifiedAddress: vi.fn(),
      sendFromAccount: vi.fn(),
    };
    try {
      await expect(
        executePartialRefund({
          store,
          broadcaster,
          merchantAccountUuid: "merchant-account",
          paymentTxid: payment.paymentTxId,
          amountZat: 500000,
          idempotencyKey: "held",
        }),
      ).rejects.toThrow("disabled on mainnet");
      expect(store.refundTotals(payment.id)).toEqual({
        refundedZat: 0,
        reservedZat: 500000,
        inProgress: true,
      });
      expect(store.findRefund("held")?.status).toBe("broadcast_unknown");
      expect(store.findByTxid(payment.paymentTxId)?.refundAddress).toBe(
        payment.refundAddress,
      );
      expect(broadcaster.sendFromAccount).not.toHaveBeenCalled();
    } finally {
      store.close();
      vi.unstubAllEnvs();
    }
  });
  it("blocks a concurrent retry without corrupting the active broadcast", async () => {
    const store = storeWithPayment();
    let finish!: (txid: string) => void;
    const sendFromAccount = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const options = {
      broadcaster: {
        spendableShieldedBalanceZat: vi.fn(async () => 10000000),
        sendFromAccount,
        decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
      },
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500_000,
      idempotencyKey: "payment_001_refund",
      store,
    };
    const first = executePartialRefund(options);
    await expect(executePartialRefund(options)).rejects.toThrow("in progress");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish("c".repeat(64));
    await expect(first).resolves.toMatchObject({ broadcast: true });
    expect(sendFromAccount).toHaveBeenCalledTimes(1);
    expect(store.findRefundByPayment(payment.id)?.status).toBe("broadcast");
    store.close();
  });
  it("broadcasts once and returns the same txid on retry", async () => {
    const store = storeWithPayment();
    const sendFromAccount = vi.fn(async () => "c".repeat(64));
    const options = {
      broadcaster: {
        spendableShieldedBalanceZat: vi.fn(async () => 10000000),
        sendFromAccount,
        decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
      },
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500_000,
      idempotencyKey: "payment_001_refund",
      store,
    };

    await expect(executePartialRefund(options)).resolves.toEqual({
      broadcast: true,
      txid: "c".repeat(64),
    });
    await expect(executePartialRefund(options)).resolves.toEqual({
      broadcast: false,
      txid: "c".repeat(64),
    });
    expect(sendFromAccount).toHaveBeenCalledTimes(1);
    expect(store.findRefundByPayment(payment.id)?.retryCount).toBe(1);
    expect(
      options.broadcaster.spendableShieldedBalanceZat,
    ).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("blocks retry when the broadcast result is unknown", async () => {
    const store = storeWithPayment();
    const sendFromAccount = vi.fn(async () => {
      throw new Error("connection closed");
    });
    const options = {
      broadcaster: {
        spendableShieldedBalanceZat: vi.fn(async () => 10000000),
        sendFromAccount,
        decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
      },
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500_000,
      idempotencyKey: "payment_001_refund",
      store,
    };

    await expect(executePartialRefund(options)).rejects.toThrow(
      "connection closed",
    );
    await expect(executePartialRefund(options)).rejects.toThrow("unknown");
    expect(sendFromAccount).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("rejects a refund larger than its payment", async () => {
    const store = storeWithPayment();
    await expect(
      executePartialRefund({
        broadcaster: {
          spendableShieldedBalanceZat: vi.fn(async () => 10000000),
          sendFromAccount: vi.fn(),
          decodeUnifiedAddress: async (address: string) => ({
            orchard: address,
          }),
        },
        merchantAccountUuid: "merchant-account",
        paymentTxid: payment.paymentTxId,
        amountZat: payment.amountZat + 1,
        idempotencyKey: "payment_001_refund",
        store,
      }),
    ).rejects.toThrow("cannot exceed");
    store.close();
  });
});

it("blocks unusable receiver before any instruction or broadcast", async () => {
  const store = storeWithPayment();
  const sendFromAccount = vi.fn();
  await expect(
    executePartialRefund({
      store,
      merchantAccountUuid: "merchant-account",
      paymentTxid: payment.paymentTxId,
      amountZat: 500000,
      idempotencyKey: "test_refund",
      broadcaster: {
        spendableShieldedBalanceZat: vi.fn(async () => 10000000),
        sendFromAccount,
        decodeUnifiedAddress: async () => ({ sapling: "zs1fake" }),
      },
    }),
  ).rejects.toThrow("Orchard-only");
  expect(store.findRefundByPayment(payment.id)).toBeUndefined();
  expect(sendFromAccount).not.toHaveBeenCalled();
  store.close();
});

it.each([190000, 200000, 0])(
  "rejects a known funding shortfall before reservation or spending: %s",
  async (balance) => {
    const store = storeWithPayment();
    const broadcaster = {
      spendableShieldedBalanceZat: vi.fn(async () => balance),
      decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
      sendFromAccount: vi.fn(),
    };
    await expect(
      executePartialRefund({
        store,
        broadcaster,
        merchantAccountUuid: "merchant-account",
        paymentTxid: payment.paymentTxId,
        amountZat: 200000,
        idempotencyKey: "funding-check",
      }),
    ).rejects.toThrow("cannot cover");
    expect(broadcaster.spendableShieldedBalanceZat).toHaveBeenCalledWith(
      "merchant-account",
    );
    expect(store.listRefundsByPayment(payment.id)).toEqual([]);
    expect(broadcaster.sendFromAccount).not.toHaveBeenCalled();
    store.close();
  },
);

it("fails before reservation when the balance lookup fails, and leaves an unknown send blocked", async () => {
  const store = storeWithPayment();
  const broadcaster = {
    spendableShieldedBalanceZat: vi.fn(async (): Promise<number> => {
      throw new Error("balance unavailable");
    }),
    decodeUnifiedAddress: async (address: string) => ({ orchard: address }),
    sendFromAccount: vi.fn(),
  };
  const options = {
    store,
    broadcaster,
    merchantAccountUuid: "merchant-account",
    paymentTxid: payment.paymentTxId,
    amountZat: 200000,
    idempotencyKey: "funding-check",
  };
  await expect(executePartialRefund(options)).rejects.toThrow(
    "balance unavailable",
  );
  expect(store.listRefundsByPayment(payment.id)).toEqual([]);
  broadcaster.spendableShieldedBalanceZat.mockResolvedValue(10000000);
  broadcaster.sendFromAccount.mockRejectedValue(new Error("transport failed"));
  await expect(executePartialRefund(options)).rejects.toThrow(
    "transport failed",
  );
  broadcaster.spendableShieldedBalanceZat.mockClear();
  await expect(executePartialRefund(options)).rejects.toThrow("unknown");
  expect(broadcaster.spendableShieldedBalanceZat).not.toHaveBeenCalled();
  expect(broadcaster.sendFromAccount).toHaveBeenCalledTimes(1);
  store.close();
});

it("never resends a reconciled failed instruction key", async () => {
  const store = storeWithPayment();
  vi.spyOn(store, "findRefundByKey").mockReturnValue({
    id: "closed",
    paymentId: payment.id,
    amountZat: 200000,
    idempotencyKey: "closed",
    status: "failed",
    retryCount: 0,
  });
  const broadcaster = {
    spendableShieldedBalanceZat: vi.fn(),
    decodeUnifiedAddress: vi.fn(),
    sendFromAccount: vi.fn(),
  };
  await expect(
    executePartialRefund({
      store,
      broadcaster,
      merchantAccountUuid: "merchant",
      paymentTxid: payment.id,
      amountZat: 200000,
      idempotencyKey: "closed",
    }),
  ).rejects.toThrow("closed without settlement");
  expect(broadcaster.sendFromAccount).not.toHaveBeenCalled();
  expect(broadcaster.spendableShieldedBalanceZat).not.toHaveBeenCalled();
  store.close();
});
