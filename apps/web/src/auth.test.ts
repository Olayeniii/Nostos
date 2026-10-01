import { describe, expect, it } from "vitest";
import { authorized } from "./auth.js";

describe("demo access", () => {
  it("rejects missing credentials and missing server configuration", () => {
    expect(authorized(new Request("http://localhost"), "secret")).toBe(false);
    expect(
      authorized(
        new Request("http://localhost", {
          headers: { authorization: "Bearer secret" },
        }),
        undefined,
      ),
    ).toBe(false);
  });
  it("accepts only an exact bearer token", () => {
    expect(
      authorized(
        new Request("http://localhost", {
          headers: { authorization: "Bearer secret" },
        }),
        "secret",
      ),
    ).toBe(true);
    expect(
      authorized(
        new Request("http://localhost", {
          headers: { authorization: "Bearer secreT" },
        }),
        "secret",
      ),
    ).toBe(false);
  });
});
