import { DatabaseSync } from "node:sqlite";
import { mkdirSync, openSync, closeSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type Merchant = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  wallet: string;
  destination: string;
  createdAt: string;
  refundPolicy: string;
  refundWindowDays: number | null;
};
export type Checkout = {
  id: string;
  merchantId: string;
  description: string;
  order: string;
  amountZat: number;
  tokenHash: string;
  route: string;
  status: string;
  paymentTxid: string | null;
  createdAt: string;
  paidAt: string | null;
  refundPolicy: string;
  refundWindowDays: number | null;
  refundExpiresAt: string | null;
  routeClosedReason: string | null;
};
export type RefundRequest = {
  id: string;
  checkoutId: string;
  amountZat: number;
  reason: string;
  status: "requested" | "approved" | "declined" | "settled";
  decisionReason: string;
  approvedZat: number | null;
  createdAt: string;
  decidedAt: string | null;
};
export const accountCookie = "__Host-nostos-account";
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(value, salt, 32).toString("hex");
}
export function matchesPassword(value: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  return timingSafeEqual(
    scryptSync(value, salt!, 32),
    Buffer.from(digest!, "hex"),
  );
}
export function accountHeader(token: string) {
  return `${accountCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 28800 : 0}`;
}
export function cookieToken(request: Request) {
  const cookies = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(accountCookie + "="));
  return cookies.length === 1
    ? cookies[0]!.slice(accountCookie.length + 1)
    : "";
}
export class ProductStore {
  readonly db: DatabaseSync;
  readonly key: Buffer;
  constructor(
    path = process.env.NOSTOS_PRODUCT_DATABASE_PATH,
    key = process.env.NOSTOS_PRODUCT_DATA_KEY,
  ) {
    if (!path || !key || !/^[a-f0-9]{64}$/.test(key))
      throw new Error("Product service is not configured");
    mkdirSync(dirname(path), { recursive: true });
    this.key = Buffer.from(key, "hex");
    if (path !== ":memory:") {
      closeSync(openSync(path, "a", 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON",
    );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS merchants(id TEXT PRIMARY KEY,email TEXT NOT NULL,email_hash TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',wallet TEXT NOT NULL DEFAULT '',destination TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS account_sessions(token_hash TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS checkouts(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),description TEXT NOT NULL,order_ref TEXT NOT NULL,amount_zat INTEGER NOT NULL CHECK(amount_zat>0),token_hash TEXT NOT NULL UNIQUE,receipt_token TEXT NOT NULL,route TEXT NOT NULL DEFAULT '',route_hash TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'unpaid',payment_txid TEXT UNIQUE,created_at TEXT NOT NULL,paid_at TEXT);
`);
    const add = (table: string, name: string, definition: string) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    add("merchants", "refund_policy", "TEXT NOT NULL DEFAULT …2150 tokens truncated…adcast' WHERE id=? AND payment_txid IS NULL",
      )
      .run(txid, id);
  }
  retireRoute(id: string, reason = "fully_refunded") {
    // Keep the keyed reuse fingerprint, receipt capability and accounting fields.
    this.db
      .prepare(
        "UPDATE checkouts SET route='',route_closed_reason=? WHERE id=? AND payment_txid IS NOT NULL",
      )
      .run(reason, id);
  }
  paid(id: string) {
    const c = this.checkout(id)!;
    const paidAt = c.paidAt ?? new Date().toISOString();
    const expires =
      c.refundWindowDays === null
        ? null
        : new Date(
            Date.parse(paidAt) + c.refundWindowDays * 86400000,
          ).toISOString();
    this.db
      .prepare(
        "UPDATE checkouts SET status='confirmed',paid_at=COALESCE(paid_at,?),refund_expires_at=COALESCE(refund_expires_at,?) WHERE id=?",
      )
      .run(paidAt, expires, id);
  }
  setRefundPolicy(merchantId: string, policy: string, days: number | null) {
    if (
      !policy.trim() ||
      policy.length > 1000 ||
      (days !== null && (!Number.isInteger(days) || days < 1 || days > 365))
    )
      throw new Error("Invalid refund policy.");
    this.db
      .prepare(
        "UPDATE merchants SET refund_policy=?,refund_window_days=? WHERE id=?",
      )
      .run(this.encrypt(policy.trim()), days, merchantId);
  }
  routeFingerprintMatches(id: string, route: string) {
    const row = this.db
      .prepare("SELECT route_hash FROM checkouts WHERE id=?")
      .get(id);
    return row?.route_hash === this.fingerprint(route);
  }
  restoreRoute(id: string, route: string) {
    if (!this.routeFingerprintMatches(id, route))
      throw new Error("Original return route does not match.");
    this.db
      .prepare(
        "UPDATE checkouts SET route=? WHERE id=? AND route='' AND route_closed_reason IS NULL AND status='confirmed'",
      )
      .run(this.encrypt(route), id);
  }
  refundRequests(checkoutId: string): RefundRequest[] {
    return this.db
      .prepare(
        "SELECT * FROM refund_requests WHERE checkout_id=? ORDER BY rowid",
      )
      .all(checkoutId)
      .map((row) => ({
        id: String(row.id),
        checkoutId: String(row.checkout_id),
        amountZat: Number(row.amount_zat),
        reason: this.decrypt(String(row.reason)),
        status: String(row.status) as RefundRequest["status"],
        decisionReason: this.decrypt(String(row.decision_reason)),
        approvedZat:
          row.approved_zat === null ? null : Number(row.approved_zat),
        createdAt: String(row.created_at),
        decidedAt: row.decided_at ? String(row.decided_at) : null,
      }));
  }
  refundRequest(id: string): RefundRequest | undefined {
    const row = this.db
      .prepare("SELECT checkout_id FROM refund_requests WHERE id=?")
      .get(id);
    return row
      ? this.refundRequests(String(row.checkout_id)).find((r) => r.id === id)
      : undefined;
  }
  createRefundRequest(
    checkoutId: string,
    id: string,
    amountZat: number,
    reason: string,
  ) {
    if (
      !/^[a-f0-9-]{36}$/u.test(id) ||
      !Number.isSafeInteger(amountZat) ||
      amountZat <= 0 ||
      reason.trim().length < 3 ||
      reason.length > 1000
    )
      throw new Error("Invalid refund request.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.refundRequest(id);
      if (existing) {
        if (
          existing.checkoutId !== checkoutId ||
          existing.amountZat !== amountZat ||
          existing.reason !== reason.trim()
        )
          throw new Error("Refund request key conflict.");
        this.db.exec("COMMIT");
        return existing;
      }
      const requests = this.refundRequests(checkoutId);
      const checkout = this.checkout(checkoutId);
      if (
        !checkout?.route ||
        checkout.status !== "confirmed" ||
        (checkout.refundExpiresAt &&
          Date.parse(checkout.refundExpiresAt) <= Date.now())
      )
        throw new Error("The refund request window or route is unavailable.");
      if (
        requests.length >= 20 ||
        requests.some((r) => ["requested", "approved"].includes(r.status))
      )
        throw new Error("An existing refund request needs a decision first.");
      this.db
        .prepare(
          "INSERT INTO refund_requests(id,checkout_id,amount_zat,reason,status,created_at) VALUES(?,?,?,?,'requested',?)",
        )
        .run(
          id,
          checkoutId,
          amountZat,
          this.encrypt(reason.trim()),
          new Date().toISOString(),
        );
      this.db.exec("COMMIT");
      return this.refundRequest(id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  decideRefundRequest(
    id: string,
    decision: "approved" | "declined",
    reason: string,
    amountZat?: number,
  ) {
    if (reason.trim().length < 3 || reason.length > 1000)
      throw new Error("A decision reason is required.");
    const r = this.refundRequest(id);
    if (!r) throw new Error("Refund request unavailable.");
    if (
      r.status === "approved" &&
      decision === "approved" &&
      r.approvedZat === amountZat &&
      r.decisionReason === reason.trim()
    )
      return r;
    if (
      r.status !== "requested" ||
      (decision === "approved" && (!amountZat || amountZat > r.amountZat))
    )
      throw new Error("Refund request decision conflict.");
    const result = this.db
      .prepare(
        "UPDATE refund_requests SET status=?,decision_reason=?,approved_zat=?,decided_at=? WHERE id=? AND status='requested'",
      )
      .run(
        decision,
        this.encrypt(reason.trim()),
        amountZat ?? null,
        new Date().toISOString(),
        id,
      );
    if (result.changes !== 1)
      throw new Error("Refund request changed during review.");
    return this.refundRequest(id)!;
  }
  settleRefundRequest(id: string) {
    this.db
      .prepare(
        "UPDATE refund_requests SET status='settled' WHERE id=? AND status='approved'",
      )
      .run(id);
  }
}
