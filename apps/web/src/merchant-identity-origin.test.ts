import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverIdentityEmail } from "./merchant-identity.js";

beforeEach(() => {
  vi.stubEnv("NOSTOS_NETWORK", "testnet");
  vi.stubEnv("NOSTOS_EMAIL_API_KEY", "public-test-placeholder");
  vi.stubEnv("NOSTOS_EMAIL_FROM", "NOSTOS <accounts@example.com>");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("preserves the existing production origin when testnet has no override", async () => {
  await deliverIdentityEmail("owner@example.com", "a".repeat(43), "verify");
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(body.text).toContain(
    "https://nostos.iyforge.xyz/account-link#" + "a".repeat(43),
  );
});
it.each(["verify", "reset", "email"] as const)(
  "keeps %s links in the explicitly configured preview",
  async (purpose) => {
    vi.stubEnv("NOSTOS_NETWORK", "mainnet");
    vi.stubEnv("NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN", "http://localhost:3108");
    vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "http://localhost:3108");
    await deliverIdentityEmail("owner@example.com", "b".repeat(43), purpose);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.text).toContain(
      "http://localhost:3108/account-link#" + "b".repeat(43),
    );
    expect(body.text).not.toContain("nostos.iyforge.xyz");
  },
);
it.each([
  "http://external.example",
  "https://preview.example/path",
  "https://preview.example#fragment",
  "https://user:password@preview.example",
  "https://preview.example?query=1",
  "https://preview.example/",
  "https://one.example,https://two.example",
  "",
  "https://unlisted.example",
])(
  "refuses an unsafe or unlisted configured origin before mail delivery: %s",
  async (origin) => {
    vi.stubEnv("NOSTOS_ACCOUNT_PUBLIC_ORIGIN", origin);
    vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://preview.example");
    await expect(
      deliverIdentityEmail("owner@example.com", "c".repeat(43), "verify"),
    ).rejects.toThrow("Account email delivery is unavailable.");
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("requires a distinct mainnet override rather than falling back to the testnet origin", async () => {
  vi.stubEnv("NOSTOS_NETWORK", "mainnet");
  vi.stubEnv("NOSTOS_ACCOUNT_PUBLIC_ORIGIN", "https://testnet.example");
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://testnet.example");
  await expect(
    deliverIdentityEmail("owner@example.com", "d".repeat(43), "verify"),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("supports a separate HTTPS preview without changing recipient or token", async () => {
  vi.stubEnv("NOSTOS_ACCOUNT_PUBLIC_ORIGIN", "https://review.example");
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://review.example");
  await deliverIdentityEmail("owner@example.com", "e".repeat(43), "reset");
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(body.to).toEqual(["owner@example.com"]);
  expect(body.text).toContain(
    "https://review.example/account-link#" + "e".repeat(43),
  );
});
