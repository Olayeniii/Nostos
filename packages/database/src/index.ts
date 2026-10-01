import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parsePaymentRecord,
  type PaymentRecord,
} from "../../core/src/index.js";

interface PaymentRow {
  id: string;
  merchant_id: string;
  order_reference: string;
  payment_txid: string;
  amount_zat: number;
  refund_address: string;
  confirmations: number;
  status: string;
}

function fromRow(row: PaymentRow): PaymentRecord {
  return parsePaymentRecord({
    id: row.id,
    merchantId: row.merchant_id,
    orderReference: row.order_reference,
    paymentTxId: row.payment_txid,
    amountZat: row.amount_zat,
    refundAddress: row.refund_address,
    confirmations: row.confirmations,
    status: row.status,
  });
}

export class SqlitePaymentStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        order_reference TEXT NOT NULL,
        payment_txid TEXT NOT NULL UNIQUE,
        amount_zat INTEGER NOT NULL CHECK (amount_zat > 0),
        refund_address TEXT NOT NULL,
        confirmations INTEGER NOT NULL CHECK (confirmations >= 0),
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scanner_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        observed_payments INTEGER NOT NULL CHECK (observed_payments >= 0),
        created_payments INTEGER NOT NULL CHECK (created_payments >= 0)
      );
    `);
  }

  close(): void {
    this.#database.close();
  }

  insertPayment(payment: PaymentRecord): {
    created: boolean;
    payment: PaymentRecord;
  } {
    const valid = parsePaymentRecord(payment);
    const result = this.#database
      .prepare(
        `INSERT INTO payments (
          id, merchant_id, order_reference, payment_txid, amount_zat,
          refund_address, confirmations, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(payment_txid) DO NOTHING`,
      )
      .run(
        valid.id,
        valid.merchantId,
        valid.orderReference,
        valid.paymentTxId,
        valid.amountZat,
        valid.refundAddress,
        valid.confirmations,
        valid.status,
        new Date().toISOString(),
      );

    const stored = this.findByTxid(valid.paymentTxId);
    if (!stored) throw new Error("Payment insert did not return a record.");
    if (
      stored.merchantId !== valid.merchantId ||
      stored.orderReference !== valid.orderReference ||
      stored.amountZat !== valid.amountZat ||
      stored.refundAddress !== valid.refundAddress
    ) {
      throw new Error("Duplicate payment txid has conflicting immutable data.");
    }
    return { created: result.changes === 1, payment: stored };
  }

  findByTxid(paymentTxId: string): PaymentRecord | undefined {
    const row = this.#database
      .prepare("SELECT * FROM payments WHERE payment_txid = ?")
      .get(paymentTxId) as unknown as PaymentRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  paymentCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM payments")
      .get() as { count: number };
    return row.count;
  }

  recordScannerRun(observedPayments: number, createdPayments: number): void {
    this.#database
      .prepare(
        `INSERT INTO scanner_runs (
          started_at, observed_payments, created_payments
        ) VALUES (?, ?, ?)`,
      )
      .run(new Date().toISOString(), observedPayments, createdPayments);
  }

  scannerRunCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM scanner_runs")
      .get() as { count: number };
    return row.count;
  }
}
