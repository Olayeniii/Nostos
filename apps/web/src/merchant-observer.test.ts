import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductStore, accountHeader } from "./product-store.js";
import {
  connectObserver,
  observerConnection,
  observerWallet,
  merchantStoreReady,
  setupObserverStore,
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
it("saves observer store metadata through the API, survives reopen and keeps payments held", async () => {
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await connectObserver(
    store,
    merchantId,
    { ...input(), scopeConsent: true },
    rpc,
    node,
  );
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38235");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE", "/observer/.cookie");
  vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL", "");
  vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE", "");
  expect(merchantStoreReady(store, merchantId)).toBe(false);
  const cookie = accountHeader(store.session(merchantId)).split(";")[0]!;
  const request = (name: string) =>
    new Request("https://nostos.example/api/product/setup", {
      method: "POST",
      headers: { cookie, origin: "https://nostos.example" },
      body: JSON.stringify({ name }),
    });
  expect((await POST(request("Preview store"))).status).toBe(200);
  expect((await POST(request("Preview store"))).status).toBe(200);
  store.close();
  store = new ProductStore();
  const merchant = store.merchant(merchantId)!;
  expect(merchant).toMatchObject({
    name: "Preview store",
    wallet: "",
    destination: "",
  });
  expect(merchantStoreReady(store, merchantId)).toBe(true);
  const me = await GET(
    new Request("https://nostos.example/api/product/me", {
      headers: { cookie },
    }),
  );
  expect((await me.json()).merchant.ready).toBe(true);
  const dashboard = await GET(
    new Request("https://nostos.example/api/product/dashboard", {
      headers: { cookie },
    }),
  );
  expect(await dashboard.json()).toMatchObject({
    merchant: { ready: true },
    observerPreview: true,
  });
  expect(() => newRequest(store, merchant, "Still held", 1000)).toThrow(
    /Merchant-controlled/,
  );
  const payment = await POST(
    new Request("https://nostos.example/api/product/requests", {
      method: "POST",
      headers: { cookie, origin: "https://nostos.example" },
      body: JSON.stringify({ description: "Still held", amountZat: 1000 }),
    }),
  );
  expect(payment.status).toBe(409);
  expect(calls).toEqual(["getwalletstatus", "z_importviewingkey"]);
});
it("rejects store metadata before connection completes and never provisions a wallet", async () => {
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  expect(() =>
    setupObserverStore(store, merchantId, "Preview store"),
  ).toThrow();
  mode = "timeout";
  await expect(
    connectObserver(
      store,
      merchantId,
      { ...input(), scopeConsent: true },
      rpc,
      node,
    ),
  ).rejects.toThrow();
  expect(() =>
    setupObserverStore(store, merchantId, "Preview store"),
  ).toThrow();
  expect(store.merchant(merchantId)).toMatchObject({
    name: "",
    wallet: "",
    destination: "",
  });
  expect(merchantStoreReady(store, merchantId)).toBe(false);
});
it("does not convert hosted accounts or allow observer setup outside its preview", async () => {
  expect(() =>
    setupObserverStore(store, merchantId, "Preview store"),
  ).toThrow();
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await connectObserver(
    store,
    merchantId,
    { ...input(), scopeConsent: true },
    rpc,
    node,
  );
  store.finishSetup(merchantId, "Hosted store", "hosted-account", address);
  expect(() => setupObserverStore(store, merchantId, "Replacement")).toThrow();
  expect(store.merchant(merchantId)!.name).toBe("Hosted store");
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

it("reports fresh SDK sync readiness without enabling payment creation or signing", async () => {
  const { observerSyncStatus } = await import("./merchant-observer.js");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await connectObserver(
    store,
    merchantId,
    { ...input(), scopeConsent: true },
    rpc,
    node,
  );
  const statusRpc = {
    ...rpc,
    call: vi.fn(
      async <T>() =>
        ({
          nostos_sdk_preview_v1: true,
          observation_scope: "orchard-family-only",
          payments_enabled: false,
          account_connected: true,
          locked: false,
          node_tip: { height: 100, blockhash: hash },
          wallet_tip: { height: 100, blockhash: hash },
          fully_synced_height: 100,
        }) as T,
    ),
  };
  expect(
    await observerSyncStatus(store, merchantId, statusRpc as ObserverRpc),
  ).toEqual({
    state: "ready",
    nodeHeight: 100,
    scannedHeight: 100,
    paymentsEnabled: false,
    signingEnabled: false,
  });
  expect(statusRpc.call).toHaveBeenCalledWith("getwalletstatus", []);
  expect(observerConnection(store, merchantId)?.syncVerified).toBe(false);
  expect(() =>
    newRequest(store, store.merchant(merchantId)!, "Still held", 1000),
  ).toThrow(/Merchant-controlled/);
});
it.each([
  { locked: true },
  { fully_synced_height: 99 },
  { wallet_tip: { height: 100, blockhash: "d".repeat(64) } },
  { fully_synced_height: null, wallet_tip: null },
])(
  "keeps incomplete or changed chain context in syncing state: %j",
  async (change) => {
    const { observerSyncStatus } = await import("./merchant-observer.js");
    vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
    vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
    await connectObserver(
      store,
      merchantId,
      { ...input(), scopeConsent: true },
      rpc,
      node,
    );
    const statusRpc = {
      ...rpc,
      call: async <T>() =>
        ({
          nostos_sdk_preview_v1: true,
          observation_scope: "orchard-family-only",
          payments_enabled: false,
          account_connected: true,
          locked: false,
          node_tip: { height: 100, blockhash: hash },
          wallet_tip: { height: 100, blockhash: hash },
          fully_synced_height: 100,
          ...change,
        }) as T,
    };
    expect((await observerSyncStatus(store, merchantId, statusRpc)).state).toBe(
      "syncing",
    );
  },
);
it.each([
  { payments_enabled: true },
  { account_connected: false },
  { nostos_sdk_preview_v1: false },
  { fully_synced_height: 101 },
  { wallet_tip: { height: 101, blockhash: hash } },
])("rejects untrusted or impossible readiness fields: %j", async (change) => {
  const { observerSyncStatus } = await import("./merchant-observer.js");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await connectObserver(
    store,
    merchantId,
    { ...input(), scopeConsent: true },
    rpc,
    node,
  );
  const statusRpc = {
    ...rpc,
    call: async <T>() =>
      ({
        nostos_sdk_preview_v1: true,
        observation_scope: "orchard-family-only",
        payments_enabled: false,
        account_connected: true,
        locked: false,
        node_tip: { height: 100, blockhash: hash },
        wallet_tip: { height: 100, blockhash: hash },
        fully_synced_height: 100,
        ...change,
      }) as T,
  };
  await expect(
    observerSyncStatus(store, merchantId, statusRpc),
  ).rejects.toThrow(/^Wallet connection could not be verified/);
});
it("does not request readiness for a missing merchant connection", async () => {
  const { observerSyncStatus } = await import("./merchant-observer.js");
  vi.stubEnv("NOSTOS_MAINNET_OBSERVER_BACKEND", "sdk-preview");
  vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
  await expect(observerSyncStatus(store, merchantId, rpc)).rejects.toThrow();
  expect(calls).toEqual([]);
});
