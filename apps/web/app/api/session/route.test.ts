import { scryptSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST, GET, DELETE } from "./route.js";
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});
describe("merchant sign in boundary", () => {
  it("rejects foreign origins, authenticates a separate password, and signs out without wallet access", async () => {
    const salt = "cd".repeat(16);
    const password = "merchant-test-password";
    process.env.NOSTOS_WEB_TOKEN = "backend-test-key";
    process.env.NOSTOS_MERCHANT_PASSWORD_HASH =
      salt + ":" + scryptSync(password, salt, 32).toString("hex");
    process.env.NOSTOS_WEB_TRUSTED_ORIGINS = "https://nostos.test";
    const req = (origin: string, value: string) =>
      new Request("https://nostos.test/api/session", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: value }),
      });
    expect((await POST(req("https://foreign.test", password))).status).toBe(
      403,
    );
    expect(
      (await POST(req("https://nostos.test", "backend-test-key"))).status,
    ).toBe(401);
    const response = await POST(req("https://nostos.test", password));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    const request = new Request("https://nostos.test/api/session", {
      headers: { cookie: cookie.split(";")[0]!, origin: "https://nostos.test" },
    });
    expect(await GET(request).json()).toEqual({ authenticated: true });
    expect(DELETE(request).headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("bounds sign in attempts without trusting forwarding headers", async () => {
    process.env.NOSTOS_WEB_TOKEN = "backend-test-key";
    process.env.NOSTOS_MERCHANT_PASSWORD_HASH =
      "cd".repeat(16) + ":" + "00".repeat(32);
    process.env.NOSTOS_WEB_TRUSTED_ORIGINS = "https://nostos.test";
    let response: Response | undefined;
    for (let i = 0; i < 11; i++)
      response = await POST(
        new Request("https://nostos.test/api/session", {
          method: "POST",
          headers: {
            origin: "https://nostos.test",
            "x-forwarded-for": String(i),
          },
          body: '{"password":"incorrect-password"}',
        }),
      );
    expect(response!.status).toBe(429);
    expect(response!.headers.get("retry-after")).toBe("60");
  });
});
