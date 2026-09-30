import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface WalletState {
  accountUuid: string;
  fundingAddress: string;
}

export interface SpikeState {
  network: string;
  customer?: WalletState;
  merchant?: WalletState;
  payment?: {
    amountZec: number;
    memoHex: string;
    orderReference: string;
    refundAddress: string;
    txid: string;
  };
  detected?: {
    amountZec: number;
    confirmations: number;
    pool: "orchard" | "sapling";
  };
  refund?: {
    amountZec: number;
    txid: string;
  };
  verifiedAt?: string;
}

export async function loadState(path: string): Promise<SpikeState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SpikeState;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { network: process.env.NOSTOS_NETWORK?.trim() || "testnet" };
    }
    throw error;
  }
}

export async function saveState(
  path: string,
  state: SpikeState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function maskAddress(address: string): string {
  if (address.length <= 16) return "[shielded-address]";
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}
