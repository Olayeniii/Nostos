import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductStore, accountHeader } from "./product-store.js";
import {
  issueIdentityToken,
  consumeIdentityToken,
  identityLimit,
} from "./merchant-identity.js";
import { GET, POST } from "../app/api/product/[...action]/route.js";
let store: ProductStore, dir: string;
const password = "a-long-private-password",
  newPassword = "a-different-private-password";
function req(path: string, body: unknown = {}, cookie = "", method = "POST") {
  return new Request("https://nostos.example/api/product/" + path, {
    method,
    headers: {
      origin: "https://nostos.example",
      "Content-Type": "application/json",
      cookie,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function mailToken() {
  const call = vi.mocked(fetch).mock.calls.at(-1)!;
  const body = JSON.parse(String(call[1]?.body));
  return /account-link#([A-Za-z0-9_-]{43})/.exec(body.text)![1]!;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nostos-identity-"));
  vi.stubEnv("NOSTOS_PRODUCT_DATABASE_PATH", join(dir, "accounts.sqlite"));
  vi.stubEnv("NOSTOS_PRODUCT_CORE_DATABASE_PATH", join(dir, "payments.sqlite"));
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "a".repeat(64));
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  vi.stubEnv("NOSTOS_EMAIL_API_KEY", "test-placeholder");
  vi.stubEnv("NOSTOS_EMAIL_FROM", "NOSTOS <accounts@example.com>");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ id: "mail" })),
  );
  store = new ProductStore();
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
describe("merchant email ownership", () => {
  it("registration sends only a verification link, grants no session and blocks all merchant operations", async () => {
    const r = await POST(req("signup", { email: "new@example.com" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
    const m = store.db.prepare("SELECT id FROM merchants").get()!;
    const id = String(m.id);
    expect(store.merchant(id)!.emailVerifiedAt).toBeNull();
    const oldCookie = accountHeader(store.session(id)).split(";")[0]!;
    for (const path of [
      "requests",
      "setup",
      "refund",
      "policy",
      "fulfillment",
      "refund-decision",
      "recover-route",
      "change-email",
    ]) {
      expect((await POST(req(path, {}, oldCookie))).status).toBe(401);
    }
    expect((await GET(req("dashboard", {}, oldCookie, "GET"))).status).toBe(
      401,
    );
    expect(
      (await POST(req("login", { email: "new@example.com", password }))).status,
    ).toBe(401);
    const token = mailToken();
    expect(
      JSON.stringify(store.db.prepare("SELECT * FROM identity_tokens").get()),
    ).not.toContain(token);
    const verified = await POST(
      req("account-link", { token, password: newPassword }),
    );
    expect(verified.status).toBe(200);
    expect(verified.headers.get("set-cookie")).toContain("HttpOnly");
    expect(store.merchant(id)!.emailVerifiedAt).toBeTruthy();
    expect(store.login("new@example.com", password)).toBeUndefined();
    expect(store.authenticate(req("me", {}, oldCookie))).toBeUndefined();
    expect(
      (await POST(req("account-link", { token, password: newPassword })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          req("login", { email: "new@example.com", password: newPassword }),
        )
      ).status,
    ).toBe(200);
  });
  it("expired links do not verify an account and remain invalid after restart", () => {
    const m = store.signup("expired@example.com", password);
    const token = issueIdentityToken(store, m.id, "verify", m.email, 1000);
    expect(() =>
      consumeIdentityToken(store, token, newPassword, 1801001),
    ).toThrow();
    store.close();
    store = new ProductStore();
    expect(store.merchant(m.id)!.emailVerifiedAt).toBeNull();
  });
  it("resend throttles durably and invalidates the previous verification token", async () => {
    const m = store.signup("resend@example.com", password);
    const old = issueIdentityToken(store, m.id, "verify", m.email);
    for (let i = 0; i < 3; i++)
      expect(
        (await POST(req("resend-verification", { email: m.email }))).status,
      ).toBe(200);
    expect(
      (await POST(req("resend-verification", { email: m.email }))).status,
    ).toBe(429);
    expect(() => consumeIdentityToken(store, old, newPassword)).toThrow();
    store.close();
    store = new ProductStore();
    expect(identityLimit(store, m.email)).toBe(false);
  });
  it("recovery uses only verified email and revokes sessions and all other tokens", async () => {
    const m = store.signup("recover@example.com", password);
    await POST(req("recover-password", { email: m.email }));
    expect(fetch).not.toHaveBeenCalled();
    consumeIdentityToken(
      store,
      issueIdentityToken(store, m.id, "verify", m.email),
      password,
    );
    const cookie = accountHeader(store.session(m.id)).split(";")[0]!;
    await POST(req("recover-password", { email: m.email }));
    const token = mailToken();
    consumeIdentityToken(store, token, newPassword);
    expect(store.authenticate(req("me", {}, cookie))).toBeUndefined();
    expect(store.login(m.email, newPassword)?.id).toBe(m.id);
    expect(() => consumeIdentityToken(store, token, password)).toThrow();
  });
  it("new email requires current password and verification before replacing the old address", async () => {
    const m = store.signup("old@example.com", password);
    consumeIdentityToken(
      store,
      issueIdentityToken(store, m.id, "verify", m.email),
      password,
    );
    const cookie = accountHeader(store.session(m.id)).split(";")[0]!;
    expect(
      (
        await POST(
          req(
            "change-email",
            { email: "changed@example.com", password: "wrong" },
            cookie,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          req(
            "change-email",
            { email: "changed@example.com", password },
            cookie,
          ),
        )
      ).status,
    ).toBe(200);
    expect(store.merchant(m.id)!.email).toBe(m.email);
    consumeIdentityToken(store, mailToken(), newPassword);
    expect(store.merchant(m.id)!.email).toBe("changed@example.com");
    expect(store.authenticate(req("me", {}, cookie))).toBeUndefined();
  });
  it("unknown addresses receive the same public response without an email", async () => {
    const m = store.signup("known@example.com", password);
    const known = await POST(req("resend-verification", { email: m.email }));
    const unknown = await POST(
      req("resend-verification", { email: "unknown@example.com" }),
    );
    expect(await known.json()).toEqual(await unknown.json());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("missing provider fails closed and raw provider errors never reach the API", async () => {
    vi.stubEnv("NOSTOS_EMAIL_API_KEY", "");
    expect(
      (await POST(req("signup", { email: "blocked@example.com", password })))
        .status,
    ).toBe(503);
    expect(
      store.db.prepare("SELECT COUNT(*) AS n FROM merchants").get()!.n,
    ).toBe(0);
    vi.stubEnv("NOSTOS_EMAIL_API_KEY", "test-placeholder");
    vi.mocked(fetch).mockRejectedValueOnce(
      new Error("provider-secret-message"),
    );
    const r = await POST(
      req("signup", { email: "provider@example.com", password }),
    );
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("provider-secret-message");
  });
  it("token and new email remain protected on disk and state persists after restart", () => {
    const m = store.signup("privacy@example.com", password),
      token = issueIdentityToken(store, m.id, "verify", m.email);
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const raw = readFileSync(join(dir, "accounts.sqlite")).toString();
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(m.email);
    consumeIdentityToken(store, token, password);
    store.close();
    store = new ProductStore();
    expect(store.merchant(m.id)!.emailVerifiedAt).toBeTruthy();
  });
  it("fulfillment belongs to the owning verified merchant and does not initiate a refund", async () => {
    const m = store.signup("fulfill@example.com", password),
      other = store.signup("other@example.com", password);
    for (const x of [m, other])
      consumeIdentityToken(
        store,
        issueIdentityToken(store, x.id, "verify", x.email),
        password,
      );
    const c = store.createRequest(m.id, "Delivery", "n_order", 100).checkout;
    store.paid(c.id);
    const cookie = (id: string) =>
      accountHeader(store.session(id)).split(";")[0]!;
    expect(
      (
        await POST(
          req("fulfillment", { id: c.id, state: "failed" }, cookie(other.id)),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          req("fulfillment", { id: c.id, state: "failed" }, cookie(m.id)),
        )
      ).status,
    ).toBe(200);
    expect(store.checkout(c.id)!.fulfillment).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
});
