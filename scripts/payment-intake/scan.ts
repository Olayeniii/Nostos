import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestMerchantPayments } from "../../apps/worker/src/index.js";
import { SqlitePaymentStore } from "../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const cookieFile = process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE?.trim();
const user = process.env.NOSTOS_MERCHANT_WALLET_RPC_USER?.trim();
const password = process.env.NOSTOS_MERCHANT_WALLET_RPC_PASSWORD?.trim();
const source = new ZalletRpcClient({
  url: required("NOSTOS_MERCHANT_WALLET_RPC_URL"),
  ...(cookieFile ? { cookieFile } : {}),
  ...(user ? { user } : {}),
  ...(password ? { password } : {}),
});
const store = new SqlitePaymentStore(
  resolve(
    process.env.NOSTOS_DATABASE_PATH?.trim() || "./runtime/nostos.sqlite",
  ),
);

async function historicalTxids(): Promise<string[]> {
  const configured = process.env.NOSTOS_HISTORICAL_PAYMENT_TXIDS?.trim();
  if (configured) return configured.split(",").map((txid) => txid.trim());

  const evidence = JSON.parse(
    await readFile(resolve("scripts/evidence/gate-g1.json"), "utf8"),
  ) as { payment?: { txid?: string } };
  return evidence.payment?.txid ? [evidence.payment.txid] : [];
}

try {
  const result = await ingestMerchantPayments({
    merchantId: process.env.NOSTOS_MERCHANT_ID?.trim() || "demo-merchant",
    source,
    store,
    historicalTxids: await historicalTxids(),
  });
  console.log("Nostos payment intake scan completed.");
  console.log(`Observed: ${result.observed}`);
  console.log(`Created: ${result.created}`);
  console.log(`Stored total: ${store.paymentCount()}`);
} finally {
  store.close();
}
