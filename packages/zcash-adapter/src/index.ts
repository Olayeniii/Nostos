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
  confirmations?: number;
  memo?: string;
  memoStr?: string;
  pool?: ShieldedPool | string;
  txid?: string;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  } | null;
}

const shieldedAddressPattern =
  /\b(?:utest1|u1|ztestsapling1|zs1)[a-z0-9]{20,}\b/gi;

function safeMessage(value: string): string {
  return value.replace(shieldedAddressPattern, "[shielded-address]");
}

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
    if (
      !config.url.startsWith("http://127.0.0.1:") &&
      !config.url.startsWith("http://localhost:")
    ) {
      throw new Error("Zallet RPC must use a loopback HTTP address.");
    }
    this.#config = config;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.#config.url, {
      method: "POST",
      headers: {
        authorization: await authorization(this.#config),
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

    if (!response.ok) {
      throw new Error(
        `Zallet RPC ${method} failed with HTTP ${response.status}.`,
      );
    }

    const envelope = (await response.json()) as RpcEnvelope<T>;
    if (envelope.error) {
      const code = envelope.error.code ?? "unknown";
      const message = safeMessage(
        envelope.error.message ?? "Unknown wallet error",
      );
      throw new Error(`Zallet RPC ${method} failed (${code}): ${message}`);
    }
    if (!("result" in envelope)) {
      throw new Error(`Zallet RPC ${method} returned no result.`);
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
    const notes = await this.call<unknown>("z_listunspent", [
      1,
      9_999_999,
      false,
      addresses,
    ]);
    if (!Array.isArray(notes))
      throw new Error("Zallet returned an invalid note list.");
    return notes as ShieldedNote[];
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
