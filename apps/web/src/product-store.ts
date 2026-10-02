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
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS merchants(id TEXT PRIMARY KEY,email TEXT NOT NULL,email_hash TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',wallet TEXT NOT NULL DEFAULT '',destination TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS account_sessions(token_hash TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS checkouts(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id),description TEXT NOT NULL,order_ref TEXT NOT NULL,amount_zat INTEGER NOT NULL CHECK(amount_zat>0),token_hash TEXT NOT NULL UNIQUE,receipt_token TEXT NOT NULL,route TEXT NOT NULL DEFAULT '',route_hash TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'unpaid',payment_txid TEXT UNIQUE,created_at TEXT NOT NULL,paid_at TEXT);
`);
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
    return row ? this.merchant(row.merchant_id) : undefined;
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
  paid(id: string) {
    this.db
      .prepare(
        "UPDATE checkouts SET status='confirmed',paid_at=COALESCE(paid_at,?) WHERE id=?",
      )
      .run(new Date().toISOString(), id);
  }
}
