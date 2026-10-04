import { randomBytes } from "node:crypto";
import {
  ProductStore,
  matchesPassword,
  passwordHash,
} from "./product-store.js";
export type Purpose = "verify" | "reset" | "email";
export function emailConfigured() {
  return Boolean(
    process.env.NOSTOS_EMAIL_API_KEY && process.env.NOSTOS_EMAIL_FROM,
  );
}
export function emailMerchant(store: ProductStore, email: string) {
  const row = store.db
    .prepare("SELECT id FROM merchants WHERE email_hash=?")
    .get(store.fingerprint(email));
  return row ? store.merchant(String(row.id)) : undefined;
}
export function identityLimit(
  store: ProductStore,
  key: string,
  maximum = 3,
  now = Date.now(),
) {
  const bucket = store.fingerprint("identity:" + key);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db
      .prepare("DELETE FROM identity_limits WHERE expires_at<=?")
      .run(now);
    const row = store.db
      .prepare("SELECT count FROM identity_limits WHERE bucket=?")
      .get(bucket);
    const count = Number(row?.count ?? 0) + 1;
    store.db
      .prepare(
        "INSERT INTO identity_limits VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count",
      )
      .run(bucket, count, now + 900000);
    store.db.exec("COMMIT");
    return count <= maximum;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
export function issueIdentityToken(
  store: ProductStore,
  id: string,
  purpose: Purpose,
  email: string,
  now = Date.now(),
) {
  const token = randomBytes(32).toString("base64url");
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.db
      .prepare(
        "DELETE FROM identity_tokens WHERE expires_at<=? OR (merchant_id=? AND purpose=?)",
      )
      .run(now, id, purpose);
    store.db
      .prepare("INSERT INTO identity_tokens VALUES(?,?,?,?,?)")
      .run(
        store.fingerprint(token),
        id,
        purpose,
        store.encrypt(email),
        now + 1800000,
      );
    store.db.exec("COMMIT");
    return token;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
export function consumeIdentityToken(
  store: ProductStore,
  token: string,
  password: string,
  now = Date.now(),
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error("Invalid account link or password.");
  const encoded = passwordHash(password);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const row = store.db
      .prepare(
        "SELECT * FROM identity_tokens WHERE token_hash=? AND expires_at>?",
      )
      .get(store.fingerprint(token), now);
    if (!row) throw new Error("Account link expired or already used.");
    const id = String(row.merchant_id),
      purpose = String(row.purpose);
    const merchant = store.merchant(id);
    if (!merchant || (purpose === "reset" && !merchant.emailVerifiedAt))
      throw new Error("Account link unavailable.");
    const email = store.decrypt(String(row.email));
    if (purpose !== "email" && email !== merchant.email)
      throw new Error("Account link unavailable.");
    // The email holder chooses the password. This prevents a pre-registered
    // arbitrary email from becoming usable with the registrant's old password.
    store.db
      .prepare(
        "UPDATE merchants SET email=?,email_hash=?,email_verified_at=?,password_hash=? WHERE id=?",
      )
      .run(
        store.encrypt(email),
        store.fingerprint(email),
        new Date(now).toISOString(),
        encoded,
        id,
      );
    store.db
      .prepare("DELETE FROM account_sessions WHERE merchant_id=?")
      .run(id);
    store.db.prepare("DELETE FROM identity_tokens WHERE merchant_id=?").run(id);
    store.db.exec("COMMIT");
    return store.merchant(id)!;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
export function reauthenticated(
  store: ProductStore,
  id: string,
  password: string,
) {
  const merchant = store.merchant(id);
  return Boolean(
    merchant?.emailVerifiedAt &&
      matchesPassword(password, merchant.passwordHash),
  );
}
export async function deliverIdentityEmail(
  email: string,
  token: string,
  purpose: Purpose,
) {
  if (!emailConfigured())
    throw new Error("Account email delivery is unavailable.");
  const url = "https://nostos.iyforge.xyz/account-link#" + token;
  const subject =
    purpose === "reset"
      ? "Reset your NOSTOS password"
      : "Verify your NOSTOS email";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.NOSTOS_EMAIL_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `nostos-${token}`,
      },
      body: JSON.stringify({
        from: process.env.NOSTOS_EMAIL_FROM,
        to: [email],
        subject,
        text: `${subject}\n\nOpen this link and choose your password:\n${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore it.`,
      }),
    });
    if (!response.ok) throw new Error();
  } catch {
    throw new Error("Account email delivery is unavailable.");
  }
}
