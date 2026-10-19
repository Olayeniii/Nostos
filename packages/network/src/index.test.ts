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
  it("prepares mainnet payment instructions while preserving memo and receiver policy", async () => {
    mainnetConfig();
    const s = new ProductStore();
    try {
      const m = s.signup("main@example.com", "long-test-password"),
        destination = "u1" + "a".repeat(60),
        route = "u1" + "b".repeat(60);
      s.finishSetup(m.id, "Main", "account", destination);
      const c = s.checkout(
        newRequest(s, s.merchant(m.id)!, "Order", 10000).id,
      )!;
      const rpc = {
        decodeUnifiedAddress: async (a: string) => ({ orchard: a }),
      } as unknown as Parameters<typeof preparePayment>[3];
      const p = await preparePayment(s, c, route, rpc);
      expect(p.network).toBe("mainnet");
      expect(p.uri).toContain("zcash:u1");
      expect(JSON.parse(p.memo)).toMatchObject({ p: "nostos", v: 1, r: route });
      await expect(
        preparePayment(s, c, "utest1" + "b".repeat(60), rpc),
      ).rejects.toThrow();
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
