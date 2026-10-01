import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route.js";

const previous = process.env.NOSTOS_WEB_TOKEN;
afterEach(() => {
  if (previous === undefined) delete process.env.NOSTOS_WEB_TOKEN;
  else process.env.NOSTOS_WEB_TOKEN = previous;
});

describe("refund HTTP boundary", () => {
  it("rejects an unauthenticated request before any wallet or database access", async () => {
    process.env.NOSTOS_WEB_TOKEN = "test-secret";
    const response = await POST(
      new Request("http://localhost/api/refunds", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });
  it("rejects cross-origin and missing-origin writes", async () => {
    process.env.NOSTOS_WEB_TOKEN = "test-secret";
    for (const origin of ["https://other.example", ""]) {
      const response = await POST(
        new Request("http://localhost/api/refunds", {
          method: "POST",
          headers: {
            authorization: "Bearer test-secret",
            ...(origin ? { origin } : {}),
          },
        }),
      );
      expect(response.status).toBe(403);
    }
  });
});
