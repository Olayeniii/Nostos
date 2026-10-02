import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const sessionCookie = "__Host-nostos-merchant";
const lifetime = 8 * 60 * 60;
export function loginConfigured(): boolean {
  return (
    !!process.env.NOSTOS_WEB_TOKEN &&
    /^[a-f0-9]{32}:[a-f0-9]{64}$/.test(
      process.env.NOSTOS_MERCHANT_PASSWORD_HASH ?? "",
    )
  );
}
export function passwordMatches(password: string): boolean {
  if (!loginConfigured() || password.length < 12 || password.length > 128)
    return false;
  const [salt, hash] = process.env.NOSTOS_MERCHANT_PASSWORD_HASH!.split(":");
  return timingSafeEqual(
    scryptSync(password, salt!, 32),
    Buffer.from(hash!, "hex"),
  );
}
function signature(payload: string): string {
  return createHmac("sha256", process.env.NOSTOS_WEB_TOKEN!)
    .update(
      "nostos:merchant-session:v1:" +
        process.env.NOSTOS_MERCHANT_PASSWORD_HASH +
        ":" +
        payload,
    )
    .digest("base64url");
}
export function newSession(now = Date.now()): string {
  if (!loginConfigured()) throw new Error("Sign in is not configured");
  const payload = `${Math.floor(now / 1000) + lifetime}.${randomBytes(24).toString("base64url")}`;
  return payload + "." + signature(payload);
}
export function validSession(request: Request, now = Date.now()): boolean {
  if (!loginConfigured()) return false;
  const cookies = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim());
  const matching = cookies.filter((v) => v.startsWith(sessionCookie + "="));
  if (matching.length !== 1) return false;
  const value = matching[0]!.slice(sessionCookie.length + 1);
  if (!/^\d{10}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(value))
    return false;
  const [expires, nonce, supplied] = value.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(expires) <= seconds || Number(expires) > seconds + lifetime)
    return false;
  return timingSafeEqual(
    Buffer.from(supplied!),
    Buffer.from(signature(expires + "." + nonce)),
  );
}
export function sessionHeader(value: string): string {
  return `${sessionCookie}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${value ? lifetime : 0}`;
}
