import { mkdirSync, openSync, closeSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parsePaymentRecord,
  parseRefundIntent,
  type PaymentRecord,
  type RefundIntent,
  type RefundRecord,
  type RefundStatus,
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

interface RefundRow {
  id: string;
  payment_id: string;
  idempotency_key: string;
  amount_zat: number;
  status: RefundStatus;
  txid: string | null;
  retry_count: number;
}

function refundFromRow(row: RefundRow): RefundRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    idempotencyKey: row.idempotency_key,
    amountZat: row.amount_zat,
    status: row.status,
    retryCount: row.retry_count,
    ...(row.txid ? { txid: row.txid } : {}),
  };
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

  constructor(
    path: string,
    private readonly codec?: {
      encrypt(value: string): string;
      decrypt(value: string): string;
    },
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    if (this.codec && path !== ":memory:") {
      closeSync(openSync(path, "a", 0o600));
      chmodSync(path, 0o600);
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA secure_delete = ON; PRAGMA busy_timeout=5000");
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
      CREATE TABLE IF NOT EXISTS refunds (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
        idempotency_key TEXT NOT NULL UNIQUE,
        amount_zat INTEGER NOT NULL CHECK (amount_zat > 0),
        status TEXT NOT NULL,
        txid TEXT UNIQUE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const refundColumns = this.#database
      .prepare("PRAGMA table_info(refunds)")
      .all() as unknown as Array<{ name: string }>;
    if (!refundColumns.some((column) => column.name === "retry_count")) {
      this.#database.exec(
        "ALTER TABLE refunds ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
      );
    }
    // Additive ledger: keep the first real refund in the legacy table so older
    // releases still see an instruction and cannot create a second first send.
    this.#database.exec(`CREATE TABLE IF NOT EXISTS refund_events (
      id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
      idempotency_key TEXT NOT NULL UNIQUE, amount_zat INTEGER NOT NULL CHECK(amount_zat>0),
      status TEXT NOT NULL, txid TEXT UNIQUE, retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS refund_events_payment ON refund_events(payment_id);
    INSERT OR IGNORE INTO refund_events (id,payment_id,idempotency_key,amount_zat,status,txid,retry_count,created_at,updated_at)
      SELECT id,payment_id,idempotency_key,amount_zat,status,txid,retry_count,created_at,updated_at FROM refunds;`);
  }

  private decodeRow(row: PaymentRow): PaymentRecord {
    return fromRow({
      ...row,
      order_reference:
        this.codec?.decrypt(row.order_reference) ?? row.order_reference,
      refund_address:
        this.codec?.decrypt(row.refund_address) ?? row.refund_address,
    });
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
        this.codec?.encrypt(valid.orderReference) ?? valid.orderReference,
        valid.paymentTxId,
        valid.amountZat,
        this.codec?.encrypt(valid.refundAddress) ?? valid.refundAddress,
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
    return row ? this.decodeRow(row) : undefined;
  }

  paymentCount(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM payments")
      .get() as { count: number };
    return row.count;
  }

  listPayments(): PaymentRecord[] {
    const rows = this.#database
      .prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT 100")
      .all() as unknown as PaymentRow[];
    return rows.map((row) => this.decodeRow(row));
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

  scannerRunSummary(): {
    runs: number;
    observedPayments: number;
    createdPayments: number;
  } {
    const row = this.#database
      .prepare(
        `SELECT
          COUNT(*) AS runs,
          COALESCE(SUM(observed_payments), 0) AS observed_payments,
          COALESCE(SUM(created_payments), 0) AS created_payments
        FROM scanner_runs`,
      )
      .get() as {
      runs: number;
      observed_payments: number;
      created_payments: number;
    };
    return {
      runs: row.runs,
      observedPayments: row.observed_payments,
      createdPayments: row.created_payments,
    };
  }

  prepareRefund(
    paymentTxid: string,
    intent: RefundIntent,
    allowMultiple = false,
  ): {
    created: boolean;
    refund: RefundRecord;
  } {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const payment = this.findByTxid(paymentTxid);
      if (!payment) throw new Error("Refund payment was not found.");
      const existing = this.findRefundByKey(intent.idempotencyKey);
      if (existing) {
        if (
          existing.paymentId !== payment.id ||
          existing.amountZat !== intent.amountZat
        )
          throw new Error("A conflicting refund already exists for this key.");
        this.#database.exec("COMMIT");
        return { created: false, refund: existing };
      }
      const valid = parseRefundIntent(intent, payment);
      const records = this.listRefundsByPayment(payment.id);
      if (
        records.some((r) => r.status !== "confirmed" && r.status !== "failed")
      )
        throw new Error("A refund is in progress or its broadcast is unknown.");
      if (records.length && !allowMultiple)
        throw new Error(
          "A conflicting refund already exists for this payment.",
        );
      const refunded = records
        .filter((r) => r.status === "confirmed")
        .reduce((sum, r) => sum + r.amountZat, 0);
      if (valid.amountZat > payment.amountZat - refunded)
        throw new Error("Refund cannot exceed the remaining payment amount.");
      const now = new Date().toISOString();
      const values = [
        valid.id,
        valid.paymentId,
        valid.idempotencyKey,
        valid.amountZat,
        now,
        now,
      ];
      this.#database
        .prepare(
          `INSERT INTO refund_events
        (id,payment_id,idempotency_key,amount_zat,status,created_at,updated_at)
        VALUES(?,?,?,?,'pending',?,?)`,
        )
        .run(...values);
      this.#database
        .prepare(
          `INSERT INTO refunds
        (id,payment_id,idempotency_key,amount_zat,status,created_at,updated_at)
        VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(payment_id) DO NOTHING`,
        )
        .run(...values);
      this.#database.exec("COMMIT");
      return { created: true, refund: this.findRefund(valid.id)! };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  listRefundsByPayment(paymentId: string): RefundRecord[] {
    return (
      this.#database
        .prepare(
          "SELECT * FROM refund_events WHERE payment_id=? ORDER BY rowid",
        )
        .all(paymentId) as unknown as RefundRow[]
    ).map(refundFromRow);
  }
  findRefund(id: string): RefundRecord | undefined {
    const row = this.#database
      .prepare("SELECT * FROM refund_events WHERE id=?")
      .get(id) as unknown as RefundRow | undefined;
    return row ? refundFromRow(row) : undefined;
  }
  findRefundByKey(key: string): RefundRecord | undefined {
    const row = this.#database
      .prepare("SELECT * FROM refund_events WHERE idempotency_key=?")
      .get(key) as unknown as RefundRow | undefined;
    return row ? refundFromRow(row) : undefined;
  }
  findRefundByPayment(
    paymentId: string,
    refundId?: string,
  ): RefundRecord | undefined {
    if (refundId) {
      const refund = this.findRefund(refundId);
      return refund?.paymentId === paymentId ? refund : undefined;
    }
    return this.listRefundsByPayment(paymentId).at(-1);
  }
  refundTotals(paymentId: string) {
    const records = this.listRefundsByPayment(paymentId);
    return {
      refundedZat: records
        .filter((r) => r.status === "confirmed")
        .reduce((sum, r) => sum + r.amountZat, 0),
      reservedZat: records
        .filter((r) => r.status !== "confirmed" && r.status !== "failed")
        .reduce((sum, r) => sum + r.amountZat, 0),
      inProgress: records.some(
        (r) => r.status !== "confirmed" && r.status !== "failed",
      ),
    };
  }

  claimRefundBroadcast(paymentId: string, refundId?: string): RefundRecord {
    const refund = this.findRefundByPayment(paymentId, refundId);
    if (!refund) throw new Error("Refund instruction was not found.");
    if (refund.status === "broadcasting") {
      throw new Error(
        "Refund broadcast is already in progress; reconcile before retrying.",
      );
    }
    if (refund.status !== "pending") return refund;
    const claim = this.#database
      .prepare(
        `UPDATE refund_events SET status = 'broadcasting', updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(new Date().toISOString(), refund.id);
    if (claim.changes !== 1) {
      throw new Error(
        "Refund was claimed by another worker; retry is blocked.",
      );
    }
    this.#mirrorRefund(refund.id);
    return { ...refund, status: "broadcasting" };
  }

  recordRefundBroadcast(
    paymentId: string,
    transactionId: string,
    refundId?: string,
  ): RefundRecord {
    if (!/^[a-f0-9]{64}$/u.test(transactionId)) {
      throw new Error("Refund transaction ID is invalid.");
    }
    const refund = this.findRefundByPayment(paymentId, refundId);
    if (!refund || refund.status !== "broadcasting") {
      throw new Error("Refund is not awaiting a broadcast result.");
    }
    this.#database
      .prepare(
        `UPDATE refund_events
         SET status = 'broadcast', txid = ?, updated_at = ?
         WHERE id = ? AND status = 'broadcasting'`,
      )
      .run(transactionId, new Date().toISOString(), refund.id);
    this.#mirrorRefund(refund.id);
    const updated = this.findRefundByPayment(paymentId, refundId);
    if (!updated) throw new Error("Refund disappeared after broadcast.");
    return updated;
  }

  markRefundBroadcastUnknown(paymentId: string, refundId?: string): void {
    const refund = this.findRefundByPayment(paymentId, refundId);
    if (refund?.status === "broadcasting") {
      this.#setRefundStatus(refund.id, "broadcast_unknown");
    }
  }

  recordRefundRetry(paymentId: string, refundId?: string): RefundRecord {
    const refund = this.findRefundByPayment(paymentId, refundId);
    if (
      !refund ||
      (refund.status !== "broadcast" && refund.status !== "confirmed")
    ) {
      throw new Error("Refund retry has no completed broadcast to return.");
    }
    this.#database
      .prepare(
        `UPDATE refund_events
         SET retry_count = retry_count + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), refund.id);
    this.#mirrorRefund(refund.id);
    const updated = this.findRefundByPayment(paymentId, refundId);
    if (!updated) throw new Error("Refund disappeared after retry recording.");
    return updated;
  }

  confirmRefund(paymentId: string, refundId?: string): RefundRecord {
    const refund = this.findRefundByPayment(paymentId, refundId);
    if (!refund || refund.status !== "broadcast" || !refund.txid) {
      throw new Error("Refund is not ready for confirmation.");
    }
    this.#setRefundStatus(refund.id, "confirmed");
    return { ...refund, status: "confirmed" };
  }

  retireConfirmedRefundRoute(paymentId: string): boolean {
    const payment = this.findByTxid(paymentId);
    const totals = this.refundTotals(paymentId);
    if (!payment || totals.inProgress)
      throw new Error(
        "Return route is still required for refund reconciliation.",
      );
    if (totals.refundedZat < payment.amountZat) return false;
    this.#database
      .prepare(
        "UPDATE payments SET refund_address='',status='refunded' WHERE id=?",
      )
      .run(paymentId);
    return true;
  }
  expireRefundRoute(paymentId: string): void {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      if (this.refundTotals(paymentId).inProgress)
        throw new Error(
          "Return route is still required for refund reconciliation.",
        );
      this.#database
        .prepare(
          "UPDATE payments SET refund_address='',status='refunded' WHERE id=?",
        )
        .run(paymentId);
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
  restorePartialRefundRoute(paymentId: string, route: string): void {
    const payment = this.findByTxid(paymentId);
    const totals = this.refundTotals(paymentId);
    if (
      !payment ||
      totals.inProgress ||
      totals.refundedZat >= payment.amountZat
    )
      throw new Error("Refund capability cannot be restored.");
    this.#database
      .prepare(
        "UPDATE payments SET refund_address=?,status='confirmed' WHERE id=? AND refund_address=''",
      )
      .run(this.codec?.encrypt(route) ?? route, paymentId);
  }
  #mirrorRefund(id: string): void {
    // Only the first instruction exists in refunds; never overwrite its amount or txid.
    this.#database
      .prepare(
        `UPDATE refunds SET
      status=(SELECT status FROM refund_events WHERE id=?),
      txid=(SELECT txid FROM refund_events WHERE id=?),
      retry_count=(SELECT retry_count FROM refund_events WHERE id=?),
      updated_at=(SELECT updated_at FROM refund_events WHERE id=?) WHERE id=?`,
      )
      .run(id, id, id, id, id);
  }

  #setRefundStatus(id: string, status: RefundStatus): void {
    this.#database
      .prepare(
        "UPDATE refund_events SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, new Date().toISOString(), id);
    this.#mirrorRefund(id);
  }
}

// Operator recovery tools must require this deployed capability before applying.
export const refundReconciliationVersion = 1;
