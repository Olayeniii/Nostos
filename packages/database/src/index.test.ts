import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaymentRecord } from "../../core/src/index.js";
import { SqlitePaymentStore } from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nostos-database-"));
  directories.push(directory);
  return join(directory, "nostos.sqlite");
}

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

describe("SqlitePaymentStore", () => {
  it("keeps one payment after a scanner process restart", async () => {
    const path = await databasePath();
    const first = new SqlitePaymentStore(path);
    expect(first.insertPayment(payment).created).toBe(true);
    first.recordScannerRun(1, 1);
    first.close();

    const restarted = new SqlitePaymentStore(path);
    expect(restarted.insertPayment(payment).created).toBe(false);
    restarted.recordScannerRun(1, 0);
    expect(restarted.paymentCount()).toBe(1);
    expect(restarted.scannerRunCount()).toBe(2);
    restarted.close();
  });

  it("rejects conflicting data for an existing transaction", () => {
    const store = new SqlitePaymentStore(":memory:");
    store.insertPayment(payment);
    expect(() =>
      store.insertPayment({ ...payment, amountZat: payment.amountZat - 1 }),
    ).toThrow("conflicting immutable data");
    store.close();
  });
});
