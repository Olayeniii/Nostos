import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { executePartialRefund } from "../../apps/worker/src/refund.js";
import { SqlitePaymentStore } from "../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const paymentTxid = required("NOSTOS_REFUND_PAYMENT_TXID");
const amountZat = Number(
  process.env.NOSTOS_REFUND_AMOUNT_ZAT?.trim() || "300000",
);
if (!Number.isSafeInteger(amountZat) || amountZat <= 0) {
  throw new Error("NOSTOS_REFUND_AMOUNT_ZAT must be a positive integer.");
}

const state = JSON.parse(
  await readFile(
    resolve(
      process.env.NOSTOS_SPIKE_STATE_PATH?.trim() ||
        "./runtime/shielded-spike.json",
    ),
    "utf8",
  ),
) as { merchant?: { accountUuid?: string } };
const merchantAccountUuid = state.merchant?.accountUuid;
if (!merchantAccountUuid) throw new Error("Merchant account UUID is missing.");

const cookieFile = process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE?.trim();
const user = process.env.NOSTOS_MERCHANT_WALLET_RPC_USER?.trim();
const password = process.env.NOSTOS_MERCHANT_WALLET_RPC_PASSWORD?.trim();
const broadcaster = new ZalletRpcClient({
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

try {
  const result = await executePartialRefund({
    broadcaster,
    merchantAccountUuid,
    paymentTxid,
    amountZat,
    idempotencyKey: `refund_${paymentTxid.slice(0, 48)}`,
    store,
  });
  console.log(
    result.broadcast
      ? "Shielded partial refund broadcast."
      : "Refund already broadcast; existing transaction returned.",
  );
  console.log(`Transaction: ${result.txid}`);
  console.log(`Amount: ${amountZat} zatoshi`);
} finally {
  store.close();
}
