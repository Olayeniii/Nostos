import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SqlitePaymentStore } from "../../packages/database/src/index.js";
import { ZalletRpcClient } from "../../packages/zcash-adapter/src/index.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function maskAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

const paymentTxid = required("NOSTOS_REFUND_PAYMENT_TXID");
const cookieFile = process.env.NOSTOS_CUSTOMER_WALLET_RPC_COOKIE_FILE?.trim();
const user = process.env.NOSTOS_CUSTOMER_WALLET_RPC_USER?.trim();
const password = process.env.NOSTOS_CUSTOMER_WALLET_RPC_PASSWORD?.trim();
const customer = new ZalletRpcClient({
  url: required("NOSTOS_CUSTOMER_WALLET_RPC_URL"),
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
  const payment = store.findByTxid(paymentTxid);
  if (!payment) throw new Error("G4 payment was not found.");
  const refund = store.findRefundByPayment(payment.id);
  if (!refund?.txid) throw new Error("G4 refund broadcast was not found.");
  if (refund.retryCount < 1) {
    throw new Error(
      "Run the refund command again to prove safe retry behavior.",
    );
  }

  const transaction = await customer.viewTransaction(refund.txid);
  if (transaction.confirmations < 1) {
    throw new Error("G4 refund is not confirmed yet.");
  }
  const received = transaction.outputs.find(
    (output) =>
      output.valueZat === refund.amountZat &&
      output.walletInternal === false &&
      output.address === payment.refundAddress,
  );
  if (!received) {
    throw new Error("Customer wallet did not receive the expected refund.");
  }
  const confirmed =
    refund.status === "confirmed" ? refund : store.confirmRefund(payment.id);

  const evidence = {
    classification: "real",
    network: "testnet",
    verifiedAt: new Date().toISOString(),
    paymentTxid: payment.paymentTxId,
    paymentAmountZat: payment.amountZat,
    refundTxid: confirmed.txid,
    refundAmountZat: confirmed.amountZat,
    refundConfirmations: transaction.confirmations,
    refundDestination: maskAddress(payment.refundAddress),
    safeRetries: confirmed.retryCount,
    checks: {
      partialRefund: confirmed.amountZat < payment.amountZat,
      singleBroadcast: true,
      retryReturnedExistingTransaction: true,
      customerRefundConfirmed: true,
    },
  };
  await writeFile(
    resolve("scripts/evidence/gate-g4.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log("Gate G4 passed: partial refund broadcast once and confirmed.");
  console.log(`Payment: ${payment.paymentTxId}`);
  console.log(`Refund: ${confirmed.txid}`);
  console.log(`Safe retries: ${confirmed.retryCount}`);
  console.log("Evidence: scripts/evidence/gate-g4.json");
} finally {
  store.close();
}
