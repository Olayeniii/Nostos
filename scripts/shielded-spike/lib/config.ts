import type { ZalletRpcConfig } from "../../../packages/zcash-adapter/src/index.js";

export interface SpikeConfig {
  network: string;
  customer: ZalletRpcConfig;
  merchant: ZalletRpcConfig;
  orderReference: string;
  paymentZec: number;
  refundZec: number;
  statePath: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function amount(name: string, fallback: string): number {
  const value = process.env[name]?.trim() || fallback;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(
      `${name} must be a non-negative ZEC amount with at most 8 decimals.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return parsed;
}

function rpc(prefix: "CUSTOMER" | "MERCHANT"): ZalletRpcConfig {
  const cookieFile =
    process.env[`NOSTOS_${prefix}_WALLET_RPC_COOKIE_FILE`]?.trim();
  const user = process.env[`NOSTOS_${prefix}_WALLET_RPC_USER`]?.trim();
  const password = process.env[`NOSTOS_${prefix}_WALLET_RPC_PASSWORD`]?.trim();

  return {
    url: required(`NOSTOS_${prefix}_WALLET_RPC_URL`),
    ...(cookieFile ? { cookieFile } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}

export function loadConfig(): SpikeConfig {
  const orderReference =
    process.env.NOSTOS_ORDER_REFERENCE?.trim() || "demo-order-001";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderReference)) {
    throw new Error("NOSTOS_ORDER_REFERENCE must use 1 to 64 safe characters.");
  }

  const paymentZec = amount("NOSTOS_PAYMENT_ZEC", "0.02");
  const refundZec = amount("NOSTOS_REFUND_ZEC", "0.005");
  if (refundZec > paymentZec) {
    throw new Error("NOSTOS_REFUND_ZEC cannot exceed NOSTOS_PAYMENT_ZEC.");
  }

  return {
    network: process.env.NOSTOS_NETWORK?.trim() || "testnet",
    customer: rpc("CUSTOMER"),
    merchant: rpc("MERCHANT"),
    orderReference,
    paymentZec,
    refundZec,
    statePath:
      process.env.NOSTOS_SPIKE_STATE_PATH?.trim() ||
      "./runtime/shielded-spike.json",
  };
}
