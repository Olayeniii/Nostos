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
import {
  orchardRefundReceiver,
  prepareOrchardRefundRoute,
} from "../../../packages/zcash-adapter/src/refund-route.js";

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
  | "spendableShieldedBalanceZat"
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
    !["orchard", "sapling", "ironwood"].includes(note.pool ?? "")
  )
    return false;
  try {
    const memo = decodeMemo(note);
    return memo.o === checkout.order && memo.r === checkout.route;
  } catch {
    return false;
  }
}
async function sameOrchardReceiver(
  a: string | undefined,
  b: string,
  rpc: ProductWallet,
) {
  if (!a) return false;
  if (a === b) return true;
  if (a.startsWith("utest1") !== b.startsWith("utest1")) return false;
  try {
    const [left, right] = await Promise.all([
      rpc.decodeUnifiedAddress(a),
      rpc.decodeUnifiedAddress(b),
    ]);
    return (
      typeof left.orchard === "string" &&
      left.orchard.length > 0 &&
      left.orchard === right.orchard
    );
  } catch {
    return false;
  }
}
async function matchesReceivedNote(
  note: ShieldedNote,
  checkout: Checkout,
  merchant: Merchant,
  rpc: ProductWallet,
  unspentCandidate = false,
) {
  // Only z_listunspent candidates may omit direction. The transaction view
  // must independently establish incoming direction before payment recording.
  if (
    note.outgoing !== false &&
    !(unspentCandidate && note.outgoing === undefined)
  )
    return false;
  if (!(await sameOrchardReceiver(note.address, merchant.destination, rpc)))
    return false;
  return matchesNote(
    { ...note, address: merchant.destination, outgoing: false },
    checkout,
    merchant,
  );
}
export async function reconcile(
  store: ProductStore,
  core: SqlitePaymentStore,
  checkout: Checkout,
  rpc: ProductWallet,
  observed?: ShieldedNote[],
) {
  const merchant = store.merchant(checkout.merchantId)!;
  if (checkout.paymentTxid) {
    for (const r of store.refundRequests(checkout.id)) {
      if (
        r.status === "approved" &&
        core.findRefundByKey(`refund_${r.id}`)?.status === "confirmed"
      )
        store.settleRefundRequest(r.id);
    }
    const totals = core.refundTotals(checkout.paymentTxid);
    if (!totals.inProgress && totals.refundedZat >= checkout.amountZat) {
      core.retireConfirmedRefundRoute(checkout.paymentTxid);
      store.retireRoute(checkout.id);
      return;
    }
    if (
      refundWindowExpired(checkout) &&
      !totals.inProgress &&
      !hasOpenRequest(store, checkout.id)
    ) {
      retireExpiredCheckout(store, core, checkout.id);
      return;
    }
  }
  if (!checkout.route || !merchant.destination) return;
  await orchardRefundReceiver(checkout.route, rpc);
  let txid = checkout.paymentTxid;
  if (!txid) {
    const notes = observed ?? (await rpc.listUnspent());
    for (const note of notes) {
      if (
        note.txid &&
        (await matchesReceivedNote(note, checkout, merchant, rpc, true))
      ) {
        txid = note.txid;
        break;
      }
    }
  }
  if (txid) {
    const transaction = await rpc.viewTransaction(txid);
    if (
      transaction.txid !== txid ||
      transaction.confirmations < 1 ||
      !(
        await Promise.all(
          transaction.outputs.map((n) =>
            matchesReceivedNote(n, checkout, merchant, rpc),
          ),
        )
      ).some(Boolean)
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
    for (const refund of core.listRefundsByPayment(txid)) {
      if (refund.status !== "broadcast" || !refund.txid) continue;
      const transaction = await rpc.viewTransaction(refund.txid);
      const outputs = await Promise.all(
        transaction.outputs.map(
          async (n) =>
            n.outgoing === true &&
            n.valueZat === refund.amountZat &&
            ["orchard", "ironwood"].includes(n.pool ?? "") &&
            (await sameOrchardReceiver(n.address, checkout.route, rpc)),
        ),
      );
      if (
        transaction.txid === refund.txid &&
        transaction.confirmations > 0 &&
        outputs.some(Boolean)
      ) {
        core.confirmRefund(txid, refund.id);
      }
    }
    for (const request of store.refundRequests(checkout.id)) {
      if (
        request.status === "approved" &&
        core.findRefundByKey(`refund_${request.id}`)?.status === "confirmed"
      )
        store.settleRefundRequest(request.id);
    }
    if (
      !core.refundTotals(txid).inProgress &&
      core.retireConfirmedRefundRoute(txid)
    )
      store.retireRoute(checkout.id);
    else if (
      refundWindowExpired(checkout) &&
      !core.refundTotals(txid).inProgress &&
      !hasOpenRequest(store, checkout.id)
    ) {
      retireExpiredCheckout(store, core, checkout.id);
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
  const refunds = payment ? core.listRefundsByPayment(payment.id) : [];
  const refund = refunds.at(-1);
  const totals = payment
    ? core.refundTotals(payment.id)
    : { refundedZat: 0, reservedZat: 0, inProgress: false };
  const remaining =
    checkout.amountZat - totals.refundedZat - totals.reservedZat;
  const requests = store.refundRequests(checkout.id);
  const openRequest = requests.some((r) =>
    ["requested", "approved"].includes(r.status),
  );
  const eligible =
    !!payment &&
    !!checkout.route &&
    payment.status === "confirmed" &&
    !totals.inProgress &&
    remaining > 0;
  return {
    id: checkout.id,
    merchantName: merchant.name,
    description: checkout.description,
    orderReference: checkout.order,
    paymentAmountZat: checkout.amountZat,
    paymentConfirmations: payment?.confirmations ?? 0,
    paymentStatus: checkout.status,
    fulfillment: checkout.fulfillment,
    createdAt: checkout.createdAt,
    paidAt: checkout.paidAt,
    refundAmountZat: totals.refundedZat + totals.reservedZat,
    confirmedRefundAmountZat: totals.refundedZat,
    pendingRefundAmountZat: totals.reservedZat,
    remainingAmountZat: remaining,
    refunds: refunds.map((r) => ({
      id: r.id,
      amountZat: r.amountZat,
      status: r.status,
      txid: r.txid,
    })),
    refundRequests: requests.map((r) => ({
      id: r.id,
      amountZat: r.amountZat,
      reason: r.reason,
      status: r.status,
      decisionReason: r.decisionReason,
      approvedZat: r.approvedZat,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    })),
    canRequestRefund:
      eligible && !openRequest && !refundWindowExpired(checkout),
    canRecoverRoute:
      merchantView &&
      !!payment &&
      !checkout.route &&
      !checkout.routeClosedReason &&
      !totals.inProgress &&
      remaining > 0 &&
      !refundWindowExpired(checkout),
    refundPolicy: checkout.refundPolicy,
    refundExpiresAt: checkout.refundExpiresAt,
    refundWindowDays: checkout.refundWindowDays,
    routeClosedReason: checkout.routeClosedReason,
    status: refund?.status ?? "no_refund",
    refundTxid: refund?.txid,
    paymentTxid: checkout.paymentTxid,
    ...(merchantView && payment
      ? {
          payment: {
            ...paymentView(payment, refund, refunds),
            canRefund:
              eligible && !openRequest && !refundWindowExpired(checkout),
          },
        }
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
  route = await prepareOrchardRefundRoute(route, rpc);
  if (checkout.route && checkout.route !== route)
    throw new Error("The return route is already attached");
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
  instructionId?: string,
  requestId?: string,
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
  if (
    !requestId &&
    (hasOpenRequest(store, id) || refundWindowExpired(checkout))
  )
    throw new Error("Review the open request or refund window before sending.");
  if (requestId && store.refundRequest(requestId)?.status !== "approved")
    throw new Error("Merchant approval is required.");
  return submitRefund(
    {
      paymentTxid: payment.paymentTxId,
      amountZat,
      ...(instructionId ? { idempotencyKey: `refund_${instructionId}` } : {}),
    },
    {
      store: core,
      broadcaster: rpc,
      merchantAccountUuid: merchant.wallet,
      // Receiver validation awaits RPC. Recheck local authorization immediately
      // before the atomic reservation so an overlapping request cannot be bypassed.
      authorizeBeforePrepare: () => {
        if (
          !requestId &&
          (hasOpenRequest(store, id) ||
            refundWindowExpired(store.checkout(id)!))
        )
          throw new Error(
            "Review the open request or refund window before sending.",
          );
        if (requestId) {
          const approved = store.refundRequest(requestId);
          if (
            approved?.checkoutId !== id ||
            approved.status !== "approved" ||
            approved.approvedZat !== amountZat
          )
            throw new Error("Merchant approval is required.");
        }
      },
    },
  );
}

export function refundWindowExpired(checkout: Checkout) {
  return (
    !!checkout.refundExpiresAt &&
    Date.parse(checkout.refundExpiresAt) <= Date.now()
  );
}
function hasOpenRequest(store: ProductStore, id: string) {
  return store
    .refundRequests(id)
    .some((r) => ["requested", "approved"].includes(r.status));
}
export function requestCustomerRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  checkout: Checkout,
  id: string,
  amountZat: number,
  reason: string,
) {
  const repeated = store.refundRequest(id);
  if (repeated) {
    if (
      repeated.checkoutId !== checkout.id ||
      repeated.amountZat !== amountZat ||
      repeated.reason !== reason.trim()
    )
      throw new Error("Refund request key conflict.");
    return repeated;
  }
  if (
    !checkoutView(store, core, checkout).canRequestRefund ||
    amountZat > checkoutView(store, core, checkout).remainingAmountZat
  )
    throw new Error("Payment is not available for this refund request.");
  return store.createRefundRequest(checkout.id, id, amountZat, reason);
}
export async function decideCustomerRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchant: Merchant,
  requestId: string,
  decision: "approved" | "declined",
  reason: string,
  amountZat: number | undefined,
  rpc: ProductWallet,
) {
  const request = store.refundRequest(requestId);
  const checkout = request ? store.checkout(request.checkoutId) : undefined;
  if (!request || !checkout || checkout.merchantId !== merchant.id)
    throw new Error("Refund request unavailable.");
  if (decision === "declined")
    return store.decideRefundRequest(requestId, decision, reason);
  if (!checkout.route || !checkout.paymentTxid || !amountZat)
    throw new Error("Refund capability unavailable.");
  const existing = core.findRefundByKey(`refund_${request.id}`);
  const totals = core.refundTotals(checkout.paymentTxid);
  if (
    !existing &&
    (totals.inProgress || amountZat > checkout.amountZat - totals.refundedZat)
  )
    throw new Error(
      "Refund exceeds available value or another send needs reconciliation.",
    );
  if (existing && existing.amountZat !== amountZat)
    throw new Error("Refund amount is already fixed.");
  await orchardRefundReceiver(checkout.route, rpc);
  store.decideRefundRequest(requestId, "approved", reason, amountZat);
  return refundPayment(
    store,
    core,
    merchant,
    checkout.id,
    amountZat,
    rpc,
    requestId,
    requestId,
  );
}
export async function recoverOriginalRefundRoute(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchant: Merchant,
  id: string,
  rpc: ProductWallet,
) {
  const c = store.checkout(id);
  if (
    !c ||
    c.merchantId !== merchant.id ||
    !c.paymentTxid ||
    !checkoutView(store, core, c, true).canRecoverRoute
  )
    throw new Error("Refund capability cannot be restored.");
  const tx = await rpc.viewTransaction(c.paymentTxid);
  if (tx.txid !== c.paymentTxid || tx.confirmations < 1)
    throw new Error("Payment evidence unavailable.");
  const routes: string[] = [];
  for (const n of tx.outputs) {
    if (
      n.outgoing !== false ||
      n.valueZat !== c.amountZat ||
      !["orchard", "sapling", "ironwood"].includes(n.pool ?? "") ||
      !(await sameOrchardReceiver(n.address, merchant.destination, rpc))
    )
      continue;
    try {
      const memo = decodeMemo(n);
      if (memo.o !== c.order || !store.routeFingerprintMatches(c.id, memo.r))
        continue;
      await orchardRefundReceiver(memo.r, rpc);
      routes.push(memo.r);
    } catch {
      continue;
    }
  }
  if (routes.length !== 1)
    throw new Error("Original return route is not uniquely proven.");
  // Core first; an interruption leaves recovery available through the same fingerprint check.
  core.restorePartialRefundRoute(c.paymentTxid, routes[0]!);
  store.restoreRoute(c.id, routes[0]!);
  return { ok: true };
}

export function retireExpiredCheckout(
  store: ProductStore,
  core: SqlitePaymentStore,
  id: string,
  now = Date.now(),
) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const checkout = store.checkout(id);
    if (
      !checkout?.route ||
      !checkout.paymentTxid ||
      !checkout.refundExpiresAt ||
      Date.parse(checkout.refundExpiresAt) > now ||
      hasOpenRequest(store, id) ||
      core.refundTotals(checkout.paymentTxid).inProgress
    ) {
      store.db.exec("COMMIT");
      return false;
    }
    core.expireRefundRoute(checkout.paymentTxid);
    store.retireRoute(id, "expired");
    store.db.exec("COMMIT");
    return true;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
