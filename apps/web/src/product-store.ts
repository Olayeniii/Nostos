import { productConfiguration } from "../../../packages/network/src/index.js";
import {
  DEFAULT_REFUND_WINDOW_DAYS,
  validRefundWindow,
} from "./refund-policy.js";
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
  emailVerifiedAt: string | null;
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
  fulfillment: "pending" | "fulfilled" | "failed";
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
    path = productConfiguration().path,
    key = productConfiguration().key,
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
    const network = productConfiguration().network;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS product_environment (id INTEGER PRIMARY KEY CHECK(id=1),network TEXT NOT NULL)",
    );
    const bound = this.db
      .prepare("SELECT network FROM product_environment WHERE id=1")
      .get();
    // Existing stores are always testnet. Never relabel existing merchants.
    if (
      !bound &&
      network === "mainnet" &&
      Number(this.db.prepare("SELECT COUNT(*) AS n FROM merchants").get()!.n)
    ) {
      this.db.close();
      throw new Error("Existing store cannot be adopted as mainnet.");
    }
    this.db
      .prepare("INSERT OR IGNORE INTO product_environment VALUES(1,?)")
      .run(network);
    if (
      this.db
        .prepare("SELECT network FROM product_environment WHERE id=1")
        .get()!.network !== network
    ) {
      this.db.close();
      throw new Error("Store network does not match.");
    }
    const add = (table: string, name: string, definition: string) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    add("merchants", "email_verified_at", "TEXT");
    add("checkouts", "fulfillment", "TEXT NOT NULL DEFAULT 'pending'");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS identity_tokens(token_hash TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),purpose TEXT NOT NULL,email TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS identity_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);`);
    this.db
      .prepare("DELETE FROM identity_tokens WHERE expires_at<=?")
      .run(Date.now());
    add("merchants", "refund_policy", "TEXT NOT NULL DEFAULT ''");
    add("merchants", "refund_window_days", "INTEGER");
    add("checkouts", "refund_policy", "TEXT NOT NULL DEFAULT ''");
    add("checkouts", "refund_window_days", "INTEGER");
    add("checkouts", "refund_expires_at", "TEXT");
    add("checkouts", "route_closed_reason", "TEXT");
    this.db.exec(`CREATE TABLE IF NOT EXISTS refund_requests (
      id TEXT PRIMARY KEY, checkout_id TEXT NOT NULL REFERENCES checkouts(id),
      amount_zat INTEGER NOT NULL CHECK(amount_zat>0), reason TEXT NOT NULL,
      status TEXT NOT NULL, decision_reason TEXT NOT NULL DEFAULT '', approved_zat INTEGER,
      created_at TEXT NOT NULL, decided_at TEXT
    ); CREATE UNIQUE INDEX IF NOT EXISTS one_open_refund_request ON refund_requests(checkout_id)
      WHERE status IN ('requested','approved');`);
  }
  close() {
    this.db.close();
  }
  fingerprint(value: string) {
    return createHmac("sha256", this.key).update(value).digest("hex");
  }
  encrypt(value: string) {
    if (!value) return "";
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), body]
      .map((v) => v.toString("base64url"))
      .join(".");
  }
  decrypt(value: string) {
    if (!value) return "";
    const [n, t, b] = value.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(n!, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(t!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(b!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
  merchant(id: string): Merchant | undefined {
    const row = this.db
      .prepare("SELECT * FROM merchants WHERE id=?")
      .get(id) as Record<string, string> | undefined;
    if (!row) return;
    return {
      id: row.id!,
      email: this.decrypt(row.email!),
      passwordHash: row.password_hash!,
      name: this.decrypt(row.name!),
      wallet:
        row.wallet === "provisioning"
          ? "provisioning"
          : this.decrypt(row.wallet!),
      destination: this.decrypt(row.destination!),
      createdAt: row.created_at!,
      emailVerifiedAt: row.email_verified_at || null,
      refundPolicy: this.decrypt(row.refund_policy!),
      refundWindowDays:
        row.refund_window_days === null ? null : Number(row.refund_window_days),
    };
  }
  signup(email: string, password: string) {
    if (
      Number(
        this.db.prepare("SELECT COUNT(*) AS count FROM merchants").get()!.count,
      ) >= 100
    )
      throw new Error("Merchant capacity reached");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO merchants(id,email,email_hash,password_hash,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        this.encrypt(email),
        this.fingerprint(email),
        passwordHash(password),
        new Date().toISOString(),
      );
    return this.merchant(id)!;
  }
  login(email: string, password: string) {
    const row = this.db
      .prepare("SELECT id,password_hash FROM merchants WHERE email_hash=?")
      .get(this.fingerprint(email)) as
      | { id: string; password_hash: string }
      | undefined;
    const encoded =
      row?.password_hash ?? "00".repeat(16) + ":" + "00".repeat(32);
    return matchesPassword(password, encoded) && row
      ? this.merchant(row.id)
      : undefined;
  }
  session(id: string) {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("DELETE FROM account_sessions WHERE expires_at<=?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO account_sessions VALUES(?,?,?)")
      .run(hash(token), id, Date.now() + 28800000);
    return token;
  }
  authenticate(request: Request) {
    const token = cookieToken(request);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = this.db
      .prepare(
        "SELECT merchant_id FROM account_sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(token), Date.now()) as { merchant_id: string } | undefined;
    const merchant = row ? this.merchant(row.merchant_id) : undefined;
    return merchant?.emailVerifiedAt ? merchant : undefined;
  }
  logout(request: Request) {
    this.db
      .prepare("DELETE FROM account_sessions WHERE token_hash=?")
      .run(hash(cookieToken(request)));
  }
  claimSetup(id: string) {
    return (
      this.db
        .prepare(
          "UPDATE merchants SET wallet='provisioning' WHERE id=? AND wallet=''",
        )
        .run(id).changes === 1
    );
  }
  finishSetup(id: string, name: string, wallet: string, destination: string) {
    this.db
      .prepare("UPDATE merchants SET name=?,wallet=?,destination=? WHERE id=?")
      .run(
        this.encrypt(name),
        this.encrypt(wallet),
        this.encrypt(destination),
        id,
      );
  }
  // An interrupted setup must be reconciled by the operator, never create another account on a retry.
  requests(merchantId: string) {
    return (
      this.db
        .prepare(
          "SELECT * FROM checkouts WHERE merchant_id=? ORDER BY created_at DESC",
        )
        .all(merchantId) as unknown as Record<string, unknown>[]
    ).map((row) => this.fromCheckout(row));
  }
  fromCheckout(row: Record<string, unknown>): Checkout {
    return {
      id: String(row.id),
      fulfillment: String(
        row.fulfillment ?? "pending",
      ) as Checkout["fulfillment"],
      merchantId: String(row.merchant_id),
      description: this.decrypt(String(row.description)),
      order: this.decrypt(String(row.order_ref)),
      amountZat: Number(row.amount_zat),
      tokenHash: String(row.token_hash),
      route: this.decrypt(String(row.route)),
      status: String(row.status),
      paymentTxid: row.payment_txid ? String(row.payment_txid) : null,
      createdAt: String(row.created_at),
      paidAt: row.paid_at ? String(row.paid_at) : null,
      refundPolicy: this.decrypt(String(row.refund_policy ?? "")),
      refundWindowDays:
        row.refund_window_days === null ? null : Number(row.refund_window_days),
      refundExpiresAt: row.refund_expires_at
        ? String(row.refund_expires_at)
        : null,
      routeClosedReason: row.route_closed_reason
        ? String(row.route_closed_reason)
        : null,
    };
  }
  checkout(id: string) {
    const row = this.db
      .prepare("SELECT * FROM checkouts WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.fromCheckout(row) : undefined;
  }
  byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const row = this.db
      .prepare("SELECT * FROM checkouts WHERE token_hash=?")
      .get(hash(token)) as Record<string, unknown> | undefined;
    return row ? this.fromCheckout(row) : undefined;
  }
  createRequest(
    merchantId: string,
    description: string,
    order: string,
    amountZat: number,
  ) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "INSERT INTO checkouts(id,merchant_id,description,order_ref,amount_zat,token_hash,receipt_token,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        merchantId,
        this.encrypt(description),
        this.encrypt(order),
        amountZat,
        hash(token),
        this.encrypt(token),
        new Date().toISOString(),
      );
    const merchant = this.merchant(merchantId)!;
    this.db
      .prepare(
        "UPDATE checkouts SET refund_policy=?,refund_window_days=? WHERE id=?",
      )
      .run(
        this.encrypt(merchant.refundPolicy),
        merchant.refundWindowDays ?? DEFAULT_REFUND_WINDOW_DAYS,
        id,
      );
    return { checkout: this.checkout(id)!, token };
  }
  receiptToken(id: string, merchantId: string) {
    const row = this.db
      .prepare(
        "SELECT receipt_token FROM checkouts WHERE id=? AND merchant_id=?",
      )
      .get(id, merchantId) as { receipt_token: string } | undefined;
    return row ? this.decrypt(row.receipt_token) : undefined;
  }
  setRoute(id: string, route: string) {
    this.db
      .prepare(
        "UPDATE checkouts SET route=?,route_hash=? WHERE id=? AND status='unpaid' AND route=''",
      )
      .run(this.encrypt(route), this.fingerprint(route), id);
  }
  recordPayment(id: string, txid: string) {
    this.db
      .prepare(
        "UPDATE checkouts SET payment_txid=?,status='broadcast' WHERE id=? AND payment_txid IS NULL",
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
  setRefundPolicy(merchantId: string, policy: string, days: number) {
    if (!policy.trim() || policy.length > 1000 || !validRefundWindow(days))
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
