import { DatabaseSync } from "node:sqlite";
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
    expect(restarted.scannerRunSummary()).toEqual({
      runs: 2,
      observedPayments: 2,
      createdPayments: 1,
    });
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

it("imports an older refund table even when retry_count was appended later", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const path = await databasePath();
  const initial = new SqlitePaymentStore(path);
  initial.insertPayment(payment);
  initial.close();
  const raw = new DatabaseSync(path);
  raw.exec(`DROP TABLE refund_events; DROP TABLE refunds;
    CREATE TABLE refunds(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
      idempotency_key TEXT NOT NULL UNIQUE,amount_zat INTEGER NOT NULL,status TEXT NOT NULL,
      txid TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    ALTER TABLE refunds ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
  raw
    .prepare(
      "INSERT INTO refunds(id,payment_id,idempotency_key,amount_zat,status,txid,created_at,updated_at,retry_count) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "old_refund",
      payment.id,
      "old_key",
      1800000,
      "confirmed",
      "c".repeat(64),
      "2026-10-01",
      "2026-10-02",
      2,
    );
  raw.close();
  const migrated = new SqlitePaymentStore(path);
  expect(migrated.listRefundsByPayment(payment.id)).toEqual([
    {
      id: "old_refund",
      paymentId: payment.id,
      idempotencyKey: "old_key",
      amountZat: 1800000,
      status: "confirmed",
      txid: "c".repeat(64),
      retryCount: 2,
    },
  ]);
  expect(migrated.retireConfirmedRefundRoute(payment.id)).toBe(false);
  expect(migrated.findByTxid(payment.id)?.refundAddress).toBe(
    payment.refundAddress,
  );
  migrated.close();
});

it("reserves against the complete ledger across independent store connections and preserves the legacy guard", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const path = await databasePath();
  const one = new SqlitePaymentStore(path);
  const two = new SqlitePaymentStore(path);
  one.insertPayment(payment);
  const first = {
    id: "first_refund",
    paymentId: payment.id,
    idempotencyKey: "first_key",
    amountZat: 1800000,
  };
  const second = {
    id: "second_refund",
    paymentId: payment.id,
    idempotencyKey: "second_key",
    amountZat: 200000,
  };
  one.prepareRefund(payment.id, first, true);
  expect(() => two.prepareRefund(payment.id, second, true)).toThrow(
    "in progress",
  );
  one.claimRefundBroadcast(payment.id, first.id);
  one.recordRefundBroadcast(payment.id, "c".repeat(64), first.id);
  one.confirmRefund(payment.id, first.id);
  two.prepareRefund(payment.id, second, true);
  expect(() =>
    one.prepareRefund(
      payment.id,
      { ...second, id: "third_refund", idempotencyKey: "third_key" },
      true,
    ),
  ).toThrow();
  two.claimRefundBroadcast(payment.id, second.id);
  two.recordRefundBroadcast(payment.id, "d".repeat(64), second.id);
  two.confirmRefund(payment.id, second.id);
  expect(one.refundTotals(payment.id)).toEqual({
    refundedZat: 2000000,
    reservedZat: 0,
    inProgress: false,
  });
  expect(one.retireConfirmedRefundRoute(payment.id)).toBe(true);
  expect(() =>
    one.prepareRefund(
      payment.id,
      {
        id: "extra",
        paymentId: payment.id,
        idempotencyKey: "extra_key",
        amountZat: 1,
      },
      true,
    ),
  ).toThrow();
  one.close();
  two.close();
  const raw = new DatabaseSync(path, { readOnly: true });
  expect(
    raw.prepare("SELECT id,amount_zat,status,txid FROM refunds").get(),
  ).toMatchObject({
    id: "first_refund",
    amount_zat: 1800000,
    status: "confirmed",
    txid: "c".repeat(64),
  });
  raw.close();
  const restarted = new SqlitePaymentStore(path);
  expect(restarted.listRefundsByPayment(payment.id)).toHaveLength(2);
  restarted.close();
});

it("a reconciled failed attempt releases only its reservation and survives reopen", async () => {
  const path = await databasePath();
  const store = new SqlitePaymentStore(path);
  store.insertPayment(payment);
  store.prepareRefund(
    payment.id,
    {
      id: "settled",
      paymentId: payment.id,
      idempotencyKey: "settled",
      amountZat: 1800000,
    },
    true,
  );
  store.claimRefundBroadcast(payment.id, "settled");
  store.recordRefundBroadcast(payment.id, "c".repeat(64), "settled");
  store.confirmRefund(payment.id, "settled");
  store.prepareRefund(
    payment.id,
    {
      id: "closed",
      paymentId: payment.id,
      idempotencyKey: "closed",
      amountZat: 200000,
    },
    true,
  );
  store.claimRefundBroadcast(payment.id, "closed");
  store.markRefundBroadcastUnknown(payment.id, "closed");
  store.close();
  const raw = new DatabaseSync(path);
  raw.exec("UPDATE refund_events SET status='failed' WHERE id='closed'");
  raw.close();
  const reopened = new SqlitePaymentStore(path);
  expect(reopened.refundTotals(payment.id)).toEqual({
    refundedZat: 1800000,
    reservedZat: 0,
    inProgress: false,
  });
  expect(reopened.retireConfirmedRefundRoute(payment.id)).toBe(false);
  expect(reopened.findByTxid(payment.id)?.refundAddress).toBe(
    payment.refundAddress,
  );
  expect(reopened.findRefundByKey("closed")?.status).toBe("failed");
  reopened.prepareRefund(
    payment.id,
    {
      id: "fresh",
      paymentId: payment.id,
      idempotencyKey: "fresh",
      amountZat: 200000,
    },
    true,
  );
  expect(reopened.refundTotals(payment.id)).toEqual({
    refundedZat: 1800000,
    reservedZat: 200000,
    inProgress: true,
  });
  reopened.close();
});
