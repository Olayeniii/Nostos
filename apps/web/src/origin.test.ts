import { describe, expect, it } from "vitest";
import { trustedOrigin } from "./origin.js";

describe("explicit trusted origins", () => {
  it("accepts both exact tunnel origins by default", () => {
    expect(trustedOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(trustedOrigin("http://localhost:3000")).toBe(true);
  });
  it("rejects missing, null, lookalike, wrong port, and unlisted origins", () => {
    for (const value of [
      null,
      "null",
      "http://localhost",
      "http://127.0.0.1:3001",
      "http://localhost.evil:3000",
      "https://evil.example",
      "http://localhost:3000/",
    ])
      expect(trustedOrigin(value)).toBe(false);
  });
  it("uses configured exact origins, requires TLS outside loopback, fails closed", () => {
    expect(
      trustedOrigin("https://private.example", "https://private.example"),
    ).toBe(true);
    expect(
      trustedOrigin("http://public.example", "http://public.example"),
    ).toBe(false);
    expect(
      trustedOrigin("http://localhost:3000", "https://private.example"),
    ).toBe(false);
    expect(trustedOrigin("http://localhost:3000", "")).toBe(false);
  });
});
