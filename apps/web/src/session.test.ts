import { scryptSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorized, bearerAuthorized } from "./auth.js";
import {
  newSession,
  passwordMatches,
  sessionCookie,
  sessionHeader,
  validSession,
} from "./session.js";
const original = { ...process.env };
const password = "a-test-password-only";
const salt = "ab".repeat(16);
beforeEach(() => {
  process.env.NOSTOS_WEB_TOKEN = "test-only-server-key";
  process.env.NOSTOS_MERCHANT_PASSWORD_HASH =
    salt + ":" + scryptSync(password, salt, 32).toString("hex");
});
afterEach(() => {
  process.env = { ...original };
});
function request(value: string) {
  return new Request("https://localhost", {
    headers: { cookie: sessionCookie + "=" + value },
  });
}
describe("merchant sessions", () => {
  it("validates a separate password, never the backend token", () => {
    expect(passwordMatches(password)).toBe(true);
    expect(passwordMatches("test-only-server-key")).toBe(false);
    expect(passwordMatches("x".repeat(129))).toBe(false);
  });
  it("accepts a signed cookie and rejects tampering, duplicate cookies and expiration", () => {
    const now = Date.now();
    const value = newSession(now);
    expect(validSession(request(value), now)).toBe(true);
    expect(
      validSession(
        request(value.slice(0, -1) + (value.endsWith("a") ? "b" : "a")),
        now,
      ),
    ).toBe(false);
    expect(validSession(request(value), now + 8 * 60 * 60 * 1000)).toBe(false);
    expect(
      validSession(
        new Request("https://localhost", {
          headers: {
            cookie: `${sessionCookie}=${value}; ${sessionCookie}=${value}`,
          },
        }),
        now,
      ),
    ).toBe(false);
  });
  it("revokes old sessions on password or server key rotation and fails closed without configuration", () => {
    const value = newSession();
    process.env.NOSTOS_MERCHANT_PASSWORD_HASH = salt + ":" + "00".repeat(32);
    expect(validSession(request(value))).toBe(false);
    delete process.env.NOSTOS_MERCHANT_PASSWORD_HASH;
    expect(validSession(request(value))).toBe(false);
  });
  it("keeps the API token compatibility but does not override incorrect bearer credentials", () => {
    const value = newSession();
    expect(bearerAuthorized(request(value), "receipt-token")).toBe(false);
    expect(authorized(request(value), process.env.NOSTOS_WEB_TOKEN)).toBe(true);
    expect(
      authorized(
        new Request("https://localhost", {
          headers: {
            cookie: sessionCookie + "=" + value,
            authorization: "Bearer incorrect",
          },
        }),
        process.env.NOSTOS_WEB_TOKEN,
      ),
    ).toBe(false);
  });
  it("sets host-only secure HTTP-only cookies and clears them on sign out", () => {
    const header = sessionHeader(newSession());
    expect(header).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(header).not.toContain("Domain=");
    expect(sessionHeader("")).toContain("Max-Age=0");
  });
});
