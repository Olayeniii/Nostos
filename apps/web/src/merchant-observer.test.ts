import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductStore, accountHeader } from "./product-store.js";
import {
  connectObserver,
  observerConnection,
  observerWallet,
  type ObserverRpc,
} from "./merchant-observer.js";
import { newRequest } from "./product-service.js";
import { GET, POST } from "../app/api/product/[...action]/route.js";
import type { WalletRpc } from "./wallet-runtime.js";
let store: ProductStore,
  dir: string,
  merchantId: string,
  rpc: ObserverRpc,
  node: Pick<WalletRpc, "call">,
  calls: string[],
  mode: string;
const password = "long-observer-test-password",
  key = "uview1" + "a".repeat(140),
  address = "u1" + "b".repeat(60),
  account = "afcf8468-1814-4fea-a9f6-ce5a57505078",
  hash = "c".repeat(64);
const input = () => ({
  password,
  viewingKey: key,
  birthday: 10,
  consent: true,
});
function signup(email: string) {
  const m = store.signup(email, password);
  store.db
    .prepare("UPDATE merchants SET email_verified_at=? WHERE id=?")
    .run(new Date().toISOString(), m.id);
  return m.id;
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nostos-observer-"));
  vi.stubEnv("NOSTOS_NETWORK", "mainnet");
  vi.stubEnv("NOSTOS_MAINNET_ENABLED", "yes");
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_DATABASE_PATH",
    join(dir, "product.sqlite"),
  );
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_CORE_DATABASE_PATH",
    join(dir, "core.sqlite"),
  );
  vi.stubEnv("NOSTOS_MAINNET_PRODUCT_DATA_KEY", "b".repeat(64));
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "a".repeat(64));
  vi.stubEnv(
    "NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL",
    "http://127.0.0.1:38233",
  );
  vi.stubEnv(
    "NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE",
    "/signer/.cookie",
  );
  vi.stubEnv("NOSTOS_WEB_TRUSTED_ORIGINS", "https://nostos.example");
  store = new ProductStore();
  merchantId = signup("merchant@example.com");
  calls = [];
  mode = "valid";
  rpc = {
    call: async <T>(method: string) => {
      calls.push(method);
      if (mode === "timeout" && method === "z_importviewingkey")
        throw new Error("sensitive " + key);
      return (
        method === "getwalletstatus"
          ? { node_tip: { height: 100, blockhash: hash } }
          : {
              address_type: "unified",
              address:
                mode === "wrong-network" ? "utest1" + "b".repeat(60) : address,
              account_uuid: account,
              nostos_view_only_v1: mode !== "legacy",
            }
      ) as T;
    },
    decodeUnifiedAddress: async () => ({ orchard: address }),
  };
  node = {
    call: async <T>() =>
      ({ chain: "main", blocks: 100, bestblockhash: hash }) as T,
  };
});
afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
it("connects only view access, encrypts key/account/address and leaves payments held", async () => {
  const connected = await connectObserver(
    store,
    merchantId,
    input(),
    rpc,
    node,
  );
  expect(connected).toMatchObject({
    state: "connected",
    observerOnly: true,
    paymentsEnabled: false,
    syncVerified: false,
    address,
  });
  expect(JSON.stringify(connected)).not.toContain(key);
  const row = store.db.prepare("SELECT * FROM merchant_observers").get()!;
  for (const value of [key, account, address])
    expect(JSON.stringify(row)).not.toContain(value);
  expect(row.consent_version).toBe("business-full-viewing-key-v1");
  expect(store.merchant(merchantId)!.wallet).toBe("");
  expect(() =>
    newRequest(store, store.merchant(merchantId)!, "Order", 1000),
  ).toThrow(/Merchant-controlled/);
  expect(calls).toEqual(["getwalletstatus", "z_importviewingkey"]);
});
it.each([
  { consent: false },
  { password: "wrong" },
  { viewingKey: "secret-phrase-or-spending-key" },
  { viewingKey: "uviewtest1" + "a".repeat(140) },
  { birthday: 0 },
  { birthday: 1.5 },
])("rejects invalid access before observer calls: %j", async (change) => {
  await expect(
    connectObserver(store, merchantId, { ...input(), ...change }, rpc, node),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});
it("retains a protected pending import after timeout, rejects changed details and retries same key", async () => {
  mode = "timeout";
  await expect(
    connectObserver(store, merchantId, input(), rpc, node),
  ).rejects.toThrow(/^Wallet connection could not be verified/);
  expect(observerConnection(store, merchantId)!.state).toBe("importing");
  calls = [];
  await expect(
    connectObserver(store, merchantId, { ...input(), birthday: 11 }, rpc, node),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
  mode = "valid";
  await connectObserver(store, merchantId, input(), rpc, node);
  expect(observerConnection(store, merchantId)!.state).toBe("connected");
  expect(
    store.db.prepare("SELECT COUNT(*) AS n FROM merchant_observers").get()!.n,
  ).toBe(1);
});
it("does not allow two merchants to bind the same viewing key", async () => {
  await connectObserver(store, merchantId, input(), rpc, node);
  const other = signup("other@example.com");
  calls = [];
  await expect(
    connectObserver(store, other, input(), rpc, node),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
  expect(observerConnection(store, other)).toBeNull();
});
it.each(["legacy", "wrong-network"])(
  "rejects unsupported observer result: %s",
  async (value) => {
    mode = value;
    await expect(
      connectObserver(store, merchantId, input(), rpc, node),
    ).rejects.toThrow();
    expect(observerConnection(store, merchantId)!.state).toBe("importing");
  },
);
it("refuses to convert an existing hosted account", async () => {
  store.finishSetup(merchantId, "Store", "hosted-account", address);
  await expect(
    connectObserver(store, merchantId, input(), rpc, node),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});
it("requires independent observer configuration without signing-wallet fallback", () => {
  expect(() => observerWallet()).toThrow();
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38233");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE", "/signer/.cookie");
  expect(() => observerWallet()).toThrow();
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:39233");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE", "/observer/.cookie");
  expect(() => observerWallet()).not.toThrow();
});
it("requires session and origin, and connection status does not return the viewing key", async () => {
  await connectObserver(store, merchantId, input(), rpc, node);
  const url = "https://nostos.example/api/product/wallet-connection";
  expect((await GET(new Request(url))).status).toBe(401);
  const cookie = accountHeader(store.session(merchantId)).split(";")[0]!;
  expect(
    (
      await POST(
        new Request(url, {
          method: "POST",
          headers: { cookie, origin: "https://evil.example" },
          body: JSON.stringify(input()),
        }),
      )
    ).status,
  ).toBe(403);
  const result = await GET(new Request(url, { headers: { cookie } }));
  expect(result.status).toBe(200);
  const body = await result.text();
  expect(body).not.toContain(key);
  expect(body).not.toContain(account);
  expect(body).toContain('"paymentsEnabled":false');
});

it("keeps SDK preview mainnet-only and requires an authenticated merchant namespace", () => {
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38235");
  vi.stubEnv(
    "NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE",
    "/preview/service.cookie",
  );
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  expect(() => observerWallet(merchantId)).toThrow();
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  expect(() => observerWallet()).toThrow();
  expect(() => observerWallet(merchantId)).not.toThrow();
});
it("requires SDK scope consent before saving or importing view access", async () => {
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await expect(
    connectObserver(store, merchantId, input(), rpc, node),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  expect(observerConnection(store, merchantId)).toBeNull();
  const result = await connectObserver(
    store,
    merchantId,
    { ...input(), scopeConsent: true },
    rpc,
    node,
  );
  expect(result.paymentsEnabled).toBe(false);
  expect(
    store.db
      .prepare(
        "SELECT consent_version FROM merchant_observers WHERE merchant_id=?",
      )
      .get(merchantId)?.consent_version,
  ).toBe("sdk-orchard-view-access-v1");
});
it("does not silently convert a prior observer claim to SDK consent", async () => {
  await connectObserver(store, merchantId, input(), rpc, node);
  calls.length = 0;
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await expect(
    connectObserver(
      store,
      merchantId,
      { ...input(), scopeConsent: true },
      rpc,
      node,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
