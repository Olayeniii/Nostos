import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkObserverClient } from "./sdk-observer.js";
let dir: string, client: SdkObserverClient;
const merchant = "4b723cba-3e4d-4536-9c2e-e8129e2fb731";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nostos-sdk-client-"));
  const cookieFile = join(dir, "cookie");
  writeFileSync(cookieFile, "public-test:fixture-only", { mode: 0o600 });
  client = new SdkObserverClient(
    { url: "http://127.0.0.1:38235", cookieFile },
    merchant,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
it("binds every allowed request to the authenticated merchant namespace", async () => {
  const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    expect(body.params).toEqual([merchant]);
    expect(options.redirect).toBe("error");
    return new Response(
      JSON.stringify({
        result: {
          nostos_sdk_preview_v1: true,
          observation_scope: "orchard-family-only",
          payments_enabled: false,
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  await client.call("getwalletstatus");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("blocks inherited signer helpers before transport", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    client.sendFromAccount("account", "orchard", []),
  ).rejects.toThrow("unavailable");
  await expect(client.createAccount("new")).rejects.toThrow("unavailable");
  await expect(client.call("nostos_sync")).rejects.toThrow("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects legacy, wrong-scope and payment-enabled status responses", async () => {
  for (const result of [
    {},
    {
      nostos_sdk_preview_v1: true,
      observation_scope: "all",
      payments_enabled: false,
    },
    {
      nostos_sdk_preview_v1: true,
      observation_scope: "orchard-family-only",
      payments_enabled: true,
    },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result }))),
    );
    await expect(client.call("getwalletstatus")).rejects.toThrow(
      "could not be verified",
    );
  }
});
