import { afterEach, describe, it, expect, vi } from "vitest";
import {
  runtimeNetwork,
  addressOnNetwork,
  productConfiguration,
  runtimeValue,
} from "./index.js";
import { ProductStore } from "../../../apps/web/src/product-store.js";
import {
  coreStore,
  preparePayment,
  newRequest,
} from "../../../apps/web/src/product-service.js";
import { assertWalletReady } from "../../../apps/web/src/wallet-runtime.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WalletRpc } from "../../../apps/web/src/wallet-runtime.js";
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllEnvs();
});
function mainnetConfig() {
  const dir = mkdtempSync(join(tmpdir(), "nostos-network-"));
  cleanup = () => rmSync(dir, { recursive: true, force: true });
  vi.stubEnv("NOSTOS_NETWORK", "mainnet");
  vi.stubEnv("NOSTOS_MAINNET_ENABLED", "yes");
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_DATABASE_PATH",
    join(dir, "main-accounts.sqlite"),
  );
  vi.stubEnv(
    "NOSTOS_MAINNET_PRODUCT_CORE_DATABASE_PATH",
    join(dir, "main-payments.sqlite"),
  );
  vi.stubEnv("NOSTOS_MAINNET_PRODUCT_DATA_KEY", "b".repeat(64));
  vi.stubEnv("NOSTOS_PRODUCT_DATA_KEY", "a".repeat(64));
  vi.stubEnv(
    "NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL",
    "http://127.0.0.1:38233",
  );
  vi.stubEnv(
    "NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE",
    "/main-wallet/.cookie",
  );
  return dir;
}
describe("explicit deployment network boundary", () => {
  it("defaults only to testnet and rejects misspelled networks", () => {
    vi.stubEnv("NOSTOS_NETWORK", "testnet");
    expect(runtimeNetwork()).toBe("testnet");
    vi.stubEnv("NOSTOS_NETWORK", "main-net");
    expect(() => runtimeNetwork()).toThrow();
  });
  it("does not accept a testnet address on mainnet or a transparent destination", () => {
    expect(addressOnNetwork("utest1" + "a".repeat(60), "mainnet")).toBe(false);
    expect(addressOnNetwork("u1" + "a".repeat(60), "testnet")).toBe(false);
    expect(addressOnNetwork("t1" + "a".repeat(60), "mainnet")).toBe(false);
  });
  it("requires explicit mainnet activation and separate key, files and wallet", () => {
    mainnetConfig();
    expect(productConfiguration().network).toBe("mainnet");
    vi.stubEnv("NOSTOS_MAINNET_ENABLED", "");
    expect(() => productConfiguration()).toThrow();
    vi.stubEnv("NOSTOS_MAINNET_ENABLED", "yes");
    vi.stubEnv("NOSTOS_MAINNET_PRODUCT_DATA_KEY", "a".repeat(64));
    expect(() => productConfiguration()).toThrow();
  });
  it("never falls back from a missing mainnet RPC to testnet RPC", () => {
    mainnetConfig();
    vi.stubEnv("NOSTOS_MERCHANT_WALLET_RPC_URL", "http://127.0.0.1:28233");
    vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL", "");
    expect(runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_URL")).toBe("");
    expect(() => productConfiguration()).toThrow();
  });
  it("allows an explicit observer preview without configuring a hosted signer", () => {
    mainnetConfig();
    vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
    vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL", "");
    vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE", "");
    vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38234");
    vi.stubEnv(
      "NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE",
      "/wallet/observer/.cookie",
    );
    expect(productConfiguration().network).toBe("mainnet");
    vi.stubEnv(
      "NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL",
      "http://127.0.0.1:38233",
    );
    expect(() => productConfiguration()).toThrow(/hosted signer/);
  });
  it("rejects unknown wallet modes and missing or reused observer credentials", () => {
    mainnetConfig();
    vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "other");
    expect(() => productConfiguration()).toThrow(/wallet mode/);
    vi.stubEnv("NOSTOS_MAINNET_WALLET_MODE", "observer-preview");
    vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL", "");
    vi.stubEnv("NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE", "");
    expect(() => productConfiguration()).toThrow();
    vi.stubEnv("NOSTOS_MAINNET_OBSERVER_RPC_URL", "http://127.0.0.1:38234");
    vi.stubEnv(
      "NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE",
      "/wallet/observer/.cookie",
    );
    vi.stubEnv("NOSTOS_OBSERVER_RPC_URL", "http://127.0.0.1:38234");
    expect(() => productConfiguration()).toThrow();
  });
  it("rejects using either testnet database path for mainnet", () => {
    mainnetConfig();
    vi.stubEnv(
      "NOSTOS_PRODUCT_DATABASE_PATH",
      process.env.NOSTOS_MAINNET_PRODUCT_DATABASE_PATH,
    );
    expect(() => productConfiguration()).toThrow();
  });
  it("binds new databases to their network and refuses reopening them as testnet", () => {
    mainnetConfig();
    const s = new ProductStore(),
      c = coreStore(s);
    expect(
      s.db.prepare("SELECT network FROM product_environment").get()!.network,
    ).toBe("mainnet");
    c.close();
    s.close();
    const path = process.env.NOSTOS_MAINNET_PRODUCT_DATABASE_PATH!;
    vi.stubEnv("NOSTOS_NETWORK", "testnet");
    expect(() => new ProductStore(path, "b".repeat(64))).toThrow(/network/);
  });
  it("holds hosted mainnet requests and payment instructions without modifying records", async () => {
    mainnetConfig();
    const s = new ProductStore();
    try {
      const m = s.signup("main@example.com", "long-test-password");
      s.finishSetup(m.id, "Main", "account", "u1" + "a".repeat(60));
      expect(() => newRequest(s, s.merchant(m.id)!, "Order", 10000)).toThrow(
        /Merchant-controlled/,
      );
      expect(s.requests(m.id)).toHaveLength(0);
      // Simulate an already existing draft; the gate must not attach a route.
      const c = s.createRequest(m.id, "Order", "n_existing", 10000).checkout;
      const decode = vi.fn(async (a: string) => ({ orchard: a }));
      const rpc = { decodeUnifiedAddress: decode } as unknown as Parameters<
        typeof preparePayment
      >[3];
      await expect(
        preparePayment(s, c, "u1" + "b".repeat(60), rpc),
      ).rejects.toThrow(/Merchant-controlled/);
      expect(s.checkout(c.id)!.route).toBe("");
      expect(decode).not.toHaveBeenCalled();
    } finally {
      s.close();
    }
  });
  it("requires chain network and wallet tip hash equality, not height alone", async () => {
    vi.stubEnv("NOSTOS_NETWORK", "mainnet");
    let chain = "main",
      hash = "a".repeat(64),
      locked = false;
    const node = {
      call: async <T>() =>
        ({ chain, blocks: 100, bestblockhash: "a".repeat(64) }) as T,
    } satisfies Pick<WalletRpc, "call">;
    const wallet = {
      call: async <T>() =>
        ({
          locked,
          node_tip: { height: 100, blockhash: hash },
          wallet_tip: { height: 100, blockhash: hash },
          fully_synced_height: 100,
        }) as T,
    } satisfies Pick<WalletRpc, "call">;
    await expect(assertWalletReady(wallet, node)).resolves.toBe(100);
    chain = "test";
    await expect(assertWalletReady(wallet, node)).rejects.toThrow();
    chain = "main";
    hash = "b".repeat(64);
    await expect(assertWalletReady(wallet, node)).rejects.toThrow();
    hash = "a".repeat(64);
    locked = true;
    await expect(assertWalletReady(wallet, node)).rejects.toThrow();
  });
});
