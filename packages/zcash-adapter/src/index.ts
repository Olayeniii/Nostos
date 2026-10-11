import { readFile } from "node:fs/promises";

export type ShieldedPool = "orchard" | "sapling";

export interface ZalletRpcConfig {
  url: string;
  user?: string;
  password?: string;
  cookieFile?: string;
  timeoutMs?: number;
}

export interface ShieldedRecipient {
  address: string;
  amount: number;
  memo?: string;
}

export interface ShieldedNote {
  address?: string;
  amount?: number;
  value?: number;
  valueZat?: number;
  confirmations?: number;
  memo?: string;
  memoStr?: string;
  pool?: ShieldedPool | string;
  txid?: string;
  walletInternal?: boolean;
  outgoing?: boolean;
}

export interface ViewedTransaction {
  confirmations: number;
  outputs: ShieldedNote[];
  txid: string;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  } | null;
}

// Only fixed operation names enter diagnostics. Wallet error text may contain
// memo plaintext, encoded memos, identities, destinations or credentials.
const diagnosticMethods = new Set([
  "z_getnewaccount",
  "z_getaddressforaccount",
  "z_listunifiedreceivers",
  "z_listunspent",
  "z_viewtransaction",
  "z_sendfromaccount",
  "z_getbalanceforaccount",
]);

async function authorization(config: ZalletRpcConfig): Promise<string> {
  if (config.cookieFile) {
    const cookie = (await readFile(config.cookieFile, "utf8")).trim();
    if (!cookie.includes(":")) {
      throw new Error("Zallet RPC cookie is malformed.");
    }
    return `Basic ${Buffer.from(cookie).toString("base64")}`;
  }

  if (!config.user || !config.password) {
    throw new Error("Zallet RPC requires a cookie file or user and password.");
  }

  return `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
}

function accountUuid(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "account_uuid" in value) {
    const uuid = value.account_uuid;
    if (typeof uuid === "string" && uuid.length > 0) return uuid;
  }
  throw new Error("Zallet returned an invalid account identifier.");
}

function unifiedAddress(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "address" in value) {
    const address = value.address;
    if (typeof address === "string" && address.length > 0) return address;
  }
  throw new Error("Zallet returned an invalid unified address.");
}

function transactionId(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) return value;
  if (value && typeof value === "object" && "txid" in value) {
    const txid = value.txid;
    if (typeof txid === "string" && /^[0-9a-f]{64}$/i.test(txid)) return txid;
  }
  throw new Error("Zallet returned an invalid transaction identifier.");
}

export class ZalletRpcClient {
  readonly #config: ZalletRpcConfig;
  #nextId = 1;

  constructor(config: ZalletRpcConfig) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new Error("Zallet RPC must use a loopback HTTP address.");
    }
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error("Zallet RPC must use a loopback HTTP address.");
    }
    this.#config = { ...config, url: url.href };
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const operation = diagnosticMethods.has(method) ? method : "request";
    let access: string;
    try {
      access = await authorization(this.#config);
    } catch {
      throw new Error(`Zallet RPC ${operation} credentials are unavailable.`);
    }
    let response: Response;
    try {
      response = await fetch(this.#config.url, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: access,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.#nextId++,
          method,
          params,
        }),
        signal: AbortSignal.timeout(this.#config.timeoutMs ?? 120_000),
      });
    } catch {
      // Do not attach the original error as a cause: loggers can serialize it.
      throw new Error(`Zallet RPC ${operation} transport failed.`);
    }

    if (!response.ok) {
      throw new Error(
        `Zallet RPC ${operation} failed with HTTP ${response.status}.`,
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error(`Zallet RPC ${operation} returned invalid JSON.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Zallet RPC ${operation} returned an invalid response.`);
    }
    const envelope = value as RpcEnvelope<T>;
    if (envelope.error) {
      const code = Number.isSafeInteger(envelope.error.code)
        ? envelope.error.code
        : "unknown";
      throw new Error(`Zallet RPC ${operation} failed (${code}).`);
    }
    if (!("result" in envelope)) {
      throw new Error(`Zallet RPC ${operation} returned no result.`);
    }

    return envelope.result as T;
  }

  async createAccount(name: string): Promise<string> {
    return accountUuid(await this.call<unknown>("z_getnewaccount", [name]));
  }

  async deriveOrchardAddress(account: string): Promise<string> {
    return unifiedAddress(
      await this.call<unknown>("z_getaddressforaccount", [
        account,
        ["orchard"],
      ]),
    );
  }

  async decodeUnifiedAddress(address: string): Promise<Record<string, string>> {
    const receivers = await this.call<unknown>("z_listunifiedreceivers", [
      address,
    ]);
    if (
      !receivers ||
      typeof receivers !== "object" ||
      Array.isArray(receivers)
    ) {
      throw new Error("Zallet returned invalid unified receivers.");
    }
    return receivers as Record<string, string>;
  }

  async listUnspent(addresses: string[] = []): Promise<ShieldedNote[]> {
    const params: unknown[] = [1, 9_999_999, false];
    if (addresses.length > 0) params.push(addresses);
    const notes = await this.call<unknown>("z_listunspent", params);
    if (!Array.isArray(notes))
      throw new Error("Zallet returned an invalid note list.");
    return notes as ShieldedNote[];
  }

  async viewTransaction(txid: string): Promise<ViewedTransaction> {
    if (!/^[a-f0-9]{64}$/u.test(txid)) {
      throw new Error("Transaction ID must be 64 lowercase hex characters.");
    }
    const result = await this.call<unknown>("z_viewtransaction", [txid]);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Zallet returned an invalid transaction view.");
    }
    const transaction = result as Record<string, unknown>;
    if (!Array.isArray(transaction.outputs)) {
      throw new Error("Zallet transaction view has no output list.");
    }
    return {
      txid,
      confirmations:
        typeof transaction.confirmations === "number"
          ? transaction.confirmations
          : 0,
      outputs: transaction.outputs as ShieldedNote[],
    };
  }

  async spendableShieldedBalanceZat(account: string): Promise<number> {
    const result = await this.call<unknown>("z_getbalanceforaccount", [
      account,
      1,
    ]);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error("Wallet balance is unavailable.");
    const pools = (result as Record<string, unknown>).pools;
    if (!pools || typeof pools !== "object" || Array.isArray(pools))
      throw new Error("Wallet balance is unavailable.");
    let total = 0;
    // Orchard funding uses the current Orchard/Ironwood shielded pool family.
    // Never count transparent or Sapling funds toward an Orchard refund.
    for (const name of ["orchard", "ironwood"]) {
      const pool = (pools as Record<string, unknown>)[name];
      if (pool === undefined) continue;
      if (!pool || typeof pool !== "object" || Array.isArray(pool))
        throw new Error("Wallet balance is unavailable.");
      const value = (pool as Record<string, unknown>).valueZat;
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
      )
        throw new Error("Wallet balance is unavailable.");
      total += value;
      if (!Number.isSafeInteger(total))
        throw new Error("Wallet balance is unavailable.");
    }
    return total;
  }

  async sendFromAccount(
    account: string,
    pool: ShieldedPool,
    recipients: ShieldedRecipient[],
  ): Promise<string> {
    return transactionId(
      await this.call<unknown>("z_sendfromaccount", [
        account,
        pool,
        recipients,
        1,
        "FullPrivacy",
      ]),
    );
  }
}

export const zcashAdapterStatus = "zallet_account_rpc_spike" as const;
