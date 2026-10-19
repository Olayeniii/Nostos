import { ZalletRpcClient } from "../../../packages/zcash-adapter/src/index.js";
import {
  runtimeNetwork,
  runtimeValue,
} from "../../../packages/network/src/index.js";
export type WalletRpc = Pick<
  ZalletRpcClient,
  | "call"
  | "viewTransaction"
  | "decodeUnifiedAddress"
  | "spendableShieldedBalanceZat"
>;
export function chainWallet() {
  const url = runtimeValue("NOSTOS_CHAIN_RPC_URL"),
    cookieFile = runtimeValue("NOSTOS_CHAIN_RPC_COOKIE_FILE");
  if (!url || !cookieFile)
    throw new Error("Chain verification is not configured.");
  return new ZalletRpcClient({ url, cookieFile, timeoutMs: 10000 });
}
export async function assertChainNetwork(node: Pick<WalletRpc, "call">) {
  const info = await node.call<{
    chain: string;
    blocks: number;
    bestblockhash: string;
  }>("getblockchaininfo");
  if (
    info.chain !== (runtimeNetwork() === "mainnet" ? "main" : "test") ||
    !Number.isSafeInteger(info.blocks) ||
    !/^[a-f0-9]{64}$/i.test(info.bestblockhash)
  )
    throw new Error("Chain network is unavailable or mismatched.");
  return info;
}
export async function assertWalletReady(
  rpc: Pick<WalletRpc, "call">,
  node: Pick<WalletRpc, "call">,
) {
  const info = await assertChainNetwork(node);
  const s = await rpc.call<{
    node_tip: { height: number; blockhash: string };
    wallet_tip?: { height: number; blockhash: string };
    fully_synced_height?: number;
    locked: boolean;
    sync_work_remaining?: { unscanned_blocks: number };
  }>("getwalletstatus");
  if (
    s.locked !== false ||
    s.node_tip?.height !== info.blocks ||
    s.wallet_tip?.height !== info.blocks ||
    s.fully_synced_height !== info.blocks ||
    s.node_tip?.blockhash !== info.bestblockhash ||
    s.wallet_tip?.blockhash !== info.bestblockhash ||
    (s.sync_work_remaining && s.sync_work_remaining.unscanned_blocks !== 0)
  )
    throw new Error("Wallet and chain must be fully synced at the same tip.");
  return info.blocks;
}

export async function assertWalletChainIdentity(
  rpc: Pick<WalletRpc, "call">,
  node: Pick<WalletRpc, "call">,
) {
  const info = await assertChainNetwork(node);
  const status = await rpc.call<{
    node_tip?: { height: number; blockhash: string };
  }>("getwalletstatus");
  if (
    status.node_tip?.height !== info.blocks ||
    status.node_tip?.blockhash !== info.bestblockhash
  )
    throw new Error("Wallet backing chain does not match the configured node.");
}
