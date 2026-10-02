import { randomUUID } from "node:crypto";
import { ProductStore, type Checkout, type Merchant } from "./product-store.js";
import { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import {
  ZalletRpcClient,
  type ShieldedNote,
} from "../../../packages/zcash-adapter/src/index.js";
import { decodeMemo, encodeMemo } from "../../../packages/memo/src/index.js";
import { paymentView } from "../../api/src/index.js";
import { submitRefund } from "../../api/src/refund-request.js";
import { orchardRefundReceiver } from "../../../packages/zcash-adapter/src/refund-route.js";

export function wallet(timeoutMs = 2500) {
  const url = process.env.NOSTOS_MERCHANT_WALLET_RPC_URL;
  const cookieFile = process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE;
  if (!url || !cookieFile) throw new Error("Wallet service unavailable");
  return new ZalletRpcClient({ url, cookieFile, timeoutMs });
}
export type ProductWallet = Pick<
  ZalletRpcClient,
  | "createAccount"
  | "deriveOrchardAddress"
  | "decodeUnifiedAddress"
  | "listUnspent"
  | "viewTransaction"
  | "sendFromAccount"
>;
export function coreStore(store: ProductStore) {
  const path = process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH;
  if (!path || path === process.env.NOSTOS_DATABASE_PATH)
    throw new Error("Separate product payment storage required");
  return new SqlitePaymentStore(path, store);
}
export function matchesNote(
  note: ShieldedNote,
  checkout: Checkout,
  merchant: Merchant,
) {
  if (
    note.outgoing !== false ||
    note.address !== merchant.destination ||
    note.valueZat !== checkout.amountZat ||
    !["orchard", "sapling"].includes(note.pool ?? "")
  )
    return false;
  try {
    const memo = decodeMemo(note);
    return memo.o === checkout.order && memo.r === checkout.route;
  } catch {
    return false;
  }
}
export async function reconcile(
  store: ProductStore,
  core: SqlitePaymentStore,
  checkout: Checkout,
  rpc: ProductWallet,
  observed?: ShieldedNote[],
) {
  const merchant = store.merchant(checkout.merchantId)!;
  // Also finish cleanup after interruption between the two database updates.
  if (
    checkout.paymentTxid &&
    core.findRefundByPayment(checkout.paymentTxid)?.status === "confirmed"
  ) {
    core.retireConfirmedRefundRoute(checkout.paymentTxid);
    store.retireRoute(checkout.id);
    return;
  }
  if (!checkout.route || !merchant.destination) return;
  await orchardRefundReceiver(checkout.route, rpc);
  let txid = checkout.paymentTxid;
  if (!txid) {
    const notes = observed ?? (await rpc.listUnspent([merchant.destination]));
    txid =
      notes.find((n) => n.txid && matchesNote(n, checkout, merchant))?.txid ??
      null;
  }
  if (txid) {
    const transaction = await rpc.viewTransaction(txid);
    if (
      transaction.txid !== txid ||
      transaction.confirmations < 1 ||
      !transaction.outputs.some((n) => matchesNote(n, checkout, merchant))
    )
      return;
    core.insertPayment({
      id: txid,
      merchantId: merchant.id,
      orderReference: checkout.order,
      paymentTxId: txid,
      amountZat: checkout.amountZat,
      refundAddress: checkout.route,
      confirmations: transaction.confirmations,
      status: "confirmed",
    });
    store.recordPayment(checkout.id, txid);
    store.paid(checkout.id);
    const refund = core.findRefundByPayment(txid);
    if (refund?.status === "broadcast" && refund.txid) {
      const transaction = await rpc.viewTransaction(refund.txid);
      if (
        transaction.txid === refund.txid &&
        transaction.confirmations > 0 &&
        transaction.outputs.some(
          (n) =>
            n.outgoing === true &&
            n.address === checkout.route &&
            n.valueZat === refund.amountZat &&
            ["orchard", "sapling"].includes(n.pool ?? ""),
        )
      ) {
        core.confirmRefund(txid);
        core.retireConfirmedRefundRoute(txid);
        store.retireRoute(checkout.id);
      }
    }
  }
}
export function checkoutView(
  store: ProductStore,
  core: SqlitePaymentStore,
  checkout: Checkout,
  merchantView = false,
) {
  const merchant = store.merchant(checkout.merchantId)!;
  const payment = checkout.paymentTxid
    ? core.findByTxid(checkout.paymentTxid)
    : undefined;
  const refund = payment ? core.findRefundByPayment(payment.id) : undefined;
  return {
    id: checkout.id,
    merchantName: merchant.name,
    description: checkout.description,
    orderReference: checkout.order,
    paymentAmountZat: checkout.amountZat,
    paymentConfirmations: payment?.confirmations ?? 0,
    paymentStatus: checkout.status,
    createdAt: checkout.createdAt,
    paidAt: checkout.paidAt,
    refundAmountZat: refund?.amountZat ?? 0,
    status: refund?.status ?? "no_refund",
    refundTxid: refund?.txid,
    paymentTxid: checkout.paymentTxid,
    ...(merchantView && payment
      ? { payment: paymentView(payment, refund) }
      : {}),
  };
}
export async function preparePayment(
  store: ProductStore,
  checkout: Checkout,
  route: string,
  rpc: ProductWallet,
) {
  if (!/^utest1[a-z0-9]{20,500}$/.test(route))
    throw new Error("Use a fresh testnet unified address");
  if (checkout.status !== "unpaid")
    throw new Error("Payment is already recorded");
  if (checkout.route && checkout.route !== route)
    throw new Error("The return route is already attached");
  await orchardRefundReceiver(route, rpc);
  const memo = encodeMemo(checkout.order, route);
  store.setRoute(checkout.id, route);
  const saved = store.checkout(checkout.id)!;
  if (saved.route !== route)
    throw new Error("The return route is already attached");
  const destination = store.merchant(checkout.merchantId)!.destination;
  if (!destination) throw new Error("Merchant is not ready to accept payment");
  // ZIP 321 memo is base64url without padding. Never place this URI in a server URL/log.
  const uri = `zcash:${destination}?amount=${(checkout.amountZat / 1e8).toFixed(8)}&memo=${Buffer.from(memo, "hex").toString("base64url")}`;
  return {
    uri,
    destination,
    memo: Buffer.from(memo, "hex").toString("utf8"),
    amountZat: checkout.amountZat,
  };
}
export async function setupMerchant(
  store: ProductStore,
  merchant: Merchant,
  name: string,
  rpc: ProductWallet,
) {
  if (merchant.destination) return;
  if (!store.claimSetup(merchant.id))
    throw new Error("Store setup is being checked. Do not repeat it.");
  const account = await rpc.createAccount(`nostos-${merchant.id}`);
  const destination = await rpc.deriveOrchardAddress(account);
  if (!/^utest1[a-z0-9]{20,}$/.test(destination))
    throw new Error("Testnet address required");
  store.finishSetup(merchant.id, name, account, destination);
}
export function newRequest(
  store: ProductStore,
  merchant: Merchant,
  description: string,
  amountZat: number,
) {
  if (!merchant.destination) throw new Error("Set up your store first");
  if (store.requests(merchant.id).length >= 100)
    throw new Error("Payment request limit reached");
  const result = store.createRequest(
    merchant.id,
    description,
    `n_${randomUUID().replaceAll("-", "")}`,
    amountZat,
  );
  return { id: result.checkout.id, token: result.token };
}
export async function refundPayment(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchant: Merchant,
  id: string,
  amountZat: number,
  rpc: ProductWallet,
) {
  const checkout = store.checkout(id);
  if (!checkout || checkout.merchantId !== merchant.id || !checkout.paymentTxid)
    throw new Error("Payment unavailable");
  const payment = core.findByTxid(checkout.paymentTxid);
  if (
    !payment ||
    payment.merchantId !== merchant.id ||
    payment.refundAddress !== checkout.route ||
    payment.amountZat !== checkout.amountZat
  )
    throw new Error("Payment authorization rejected");
  return submitRefund(
    { paymentTxid: payment.paymentTxId, amountZat },
    { store: core, broadcaster: rpc, merchantAccountUuid: merchant.wallet },
  );
}
