import { MerchantCustodyError } from "./custody-policy.js";
import { randomUUID } from "node:crypto";
import {
  runtimeValue,
  addressOnNetwork,
} from "../../../packages/network/src/index.js";
import { encodeMemo } from "../../../packages/memo/src/index.js";
import { prepareOrchardRefundRoute } from "../../../packages/zcash-adapter/src/refund-route.js";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import type { ProductStore, Checkout } from "./product-store.js";
import {
  merchantStoreReady,
  observerConnection,
  observerRecordChecksEnabled,
  observerSyncStatus,
  observerWallet,
} from "./merchant-observer.js";
import { checkoutView } from "./product-service.js";

export function observerCommerceEnabled() {
  return (
    observerRecordChecksEnabled() &&
    runtimeValue("NOSTOS_COMMERCE_PREVIEW") === "yes"
  );
}
function connected(store: ProductStore, merchantId: string) {
  if (!observerCommerceEnabled()) throw new MerchantCustodyError();
  const merchant = store.merchant(merchantId);
  const connection = observerConnection(store, merchantId);
  if (
    !observerCommerceEnabled() ||
    !merchantStoreReady(store, merchantId) ||
    !merchant?.emailVerifiedAt ||
    merchant.wallet ||
    merchant.destination ||
    connection?.state !== "connected" ||
    connection.network !== "mainnet" ||
    !addressOnNetwork(connection.address, "mainnet")
  )
    throw new Error("Merchant payment preview is unavailable.");
  return connection.address;
}
export async function newObservedRequest(
  store: ProductStore,
  merchantId: string,
  description: string,
  amountZat: number,
) {
  const destination = connected(store, merchantId);
  if (
    description.trim().length < 2 ||
    description.trim().length > 160 ||
    !Number.isSafeInteger(amountZat) ||
    amountZat < 1 ||
    amountZat > 100000000
  )
    throw new Error("Enter a description and an amount up to 1 ZEC.");
  if (
    (await observerSyncStatus(store, merchantId, observerWallet(merchantId)))
      .state !== "ready"
  )
    throw new Error(
      "Wait for wallet synchronization before creating a payment.",
    );
  if (
    connected(store, merchantId) !== destination ||
    store.requests(merchantId).length >= 100
  )
    throw new Error("Payment request is unavailable.");
  const result = store.createRequest(
    merchantId,
    description.trim(),
    `n_${randomUUID().replaceAll("-", "")}`,
    amountZat,
  );
  return { id: result.checkout.id, token: result.token };
}
export async function prepareObservedPayment(
  store: ProductStore,
  checkout: Checkout,
  route: string,
) {
  const destination = connected(store, checkout.merchantId);
  const rpc = observerWallet(checkout.merchantId);
  if (
    (await observerSyncStatus(store, checkout.merchantId, rpc)).state !==
    "ready"
  )
    throw new Error("Wait for wallet synchronization before paying.");
  route = await prepareOrchardRefundRoute(route, rpc);
  const saved = store.checkout(checkout.id);
  if (
    !saved ||
    saved.merchantId !== checkout.merchantId ||
    saved.status !== "unpaid" ||
    !!saved.droppedAt ||
    (saved.route && saved.route !== route) ||
    connected(store, checkout.merchantId) !== destination
  )
    throw new Error("Payment details changed. Review the saved payment.");
  const memo = encodeMemo(saved.order, route);
  store.setRoute(saved.id, route);
  if (store.checkout(saved.id)?.route !== route)
    throw new Error("The return route is already attached.");
  return {
    uri: walletPaymentUri(
      destination,
      saved.amountZat,
      Buffer.from(memo, "hex").toString("utf8"),
    ),
    destination,
    amountZat: saved.amountZat,
    memo: Buffer.from(memo, "hex").toString("utf8"),
    network: "mainnet" as const,
  };
}
export function walletPaymentUri(
  recipient: string,
  amountZat: number,
  memo: string,
) {
  if (
    !addressOnNetwork(recipient, "mainnet") ||
    !Number.isSafeInteger(amountZat) ||
    amountZat < 1 ||
    Buffer.byteLength(memo) > 512
  )
    throw new Error("Wallet payment details are unavailable.");
  return `zcash:${recipient}?amount=${(amountZat / 1e8).toFixed(8)}&memo=${Buffer.from(memo).toString("base64url")}`;
}
// Approval records the merchant's decision. Only their external wallet can sign.
export function decideObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
  decision: "approved" | "declined",
  reason: string,
  amountZat?: number,
) {
  connected(store, merchantId);
  const request = store.refundRequest(requestId);
  const checkout = request && store.checkout(request.checkoutId);
  if (
    !checkout ||
    checkout.merchantId !== merchantId ||
    !request ||
    reason.trim().length < 3 ||
    reason.trim().length > 1000
  )
    throw new Error("Refund request unavailable.");
  if (
    request.status === decision &&
    request.decisionReason === reason.trim() &&
    (decision === "declined" || request.approvedZat === amountZat)
  )
    return request;
  if (request.status !== "requested")
    throw new Error("This refund decision is already saved.");
  if (decision === "approved") {
    const view = checkoutView(store, core, checkout);
    const payment =
      checkout.paymentTxid && core.findByTxid(checkout.paymentTxid);
    if (
      !payment ||
      payment.status !== "confirmed" ||
      payment.merchantId !== merchantId ||
      payment.refundAddress !== checkout.route ||
      payment.amountZat !== checkout.amountZat ||
      !checkout.route ||
      !Number.isSafeInteger(amountZat) ||
      !amountZat ||
      amountZat < 1 ||
      amountZat > request.amountZat ||
      amountZat > view.remainingAmountZat ||
      view.pendingRefundAmountZat > 0
    )
      throw new Error("Refund exceeds the confirmed available payment.");
  }
  return store.decideRefundRequest(
    requestId,
    decision,
    reason.trim(),
    amountZat,
  );
}
