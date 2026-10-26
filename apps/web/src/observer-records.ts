import { refundCheckMessages, type RefundCheckCode } from "./refund-status.js";
import { chainWallet } from "./wallet-runtime.js";
import type { ZalletRpcClient } from "../../../packages/zcash-adapter/src/index.js";
import { randomUUID } from "node:crypto";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { encodeMemo } from "../../../packages/memo/src/index.js";
import {
  addressOnNetwork,
  runtimeNetwork,
} from "../../../packages/network/src/index.js";
import { orchardRefundReceiver } from "../../../packages/zcash-adapter/src/refund-route.js";
import {
  observerConnection,
  observerWallet,
  sdkObserverSelected,
} from "./merchant-observer.js";
import { checkoutView } from "./product-service.js";
import { ProductStore } from "./product-store.js";

// Reconciliation has no signing interface and never enables mainnet payments.
// Preview callers must enforce their feature flag, session, origin and ownership.
export class ObserverRecordError extends Error {
  constructor(public readonly code?: RefundCheckCode) {
    super(
      code
        ? refundCheckMessages[code]
        : "Observer reconciliation is unresolved. Keep the saved instruction and transaction; do not send again.",
    );
  }
}
type Pool = "orchard" | "ironwood";
type Plan = {
  id: string;
  source_key: string;
  kind: "payment" | "refund";
  merchant_id: string;
  checkout_id: string;
  request_id: string | null;
  refund_id: string | null;
  fingerprint: string;
  memo: string;
  pool: Pool;
  fee_cap: number;
  txid: string | null;
  state: "pending" | "core_applied" | "applied";
  handoff_started: number;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const maxZat = 2100000000000000;
function requireValue(value: unknown): asserts value {
  if (!value) throw new ObserverRecordError();
}
function integer(value: unknown, min: number, max = maxZat): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
function dbFor(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  checkoutId: string,
) {
  requireValue(
    runtimeNetwork() === "mainnet" &&
      sdkObserverSelected() &&
      core.boundNetwork() === "mainnet",
  );
  requireValue(
    store.db.prepare("SELECT network FROM product_environment WHERE id=1").get()
      ?.network === "mainnet",
  );
  requireValue(uuid.test(merchantId) && uuid.test(checkoutId));
  requireValue(store.checkout(checkoutId)?.merchantId === merchantId);
  const db = core.withdrawalDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS observer_record_instructions (
    id TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
    merchant_id TEXT NOT NULL, checkout_id TEXT NOT NULL, request_id TEXT,
    refund_id TEXT UNIQUE REFERENCES refund_events(id), fingerprint TEXT NOT NULL,
    memo TEXT NOT NULL, pool TEXT NOT NULL, fee_cap INTEGER NOT NULL,
    txid TEXT UNIQUE, state TEXT NOT NULL DEFAULT 'pending', proof TEXT NOT NULL DEFAULT '',
    handoff_started INTEGER NOT NULL DEFAULT 0
  ); CREATE TABLE IF NOT EXISTS observer_output_claims (
    txid TEXT PRIMARY KEY, pool TEXT NOT NULL, output_index INTEGER NOT NULL,
    instruction_id TEXT UNIQUE NOT NULL REFERENCES observer_record_instructions(id),
    UNIQUE(txid,pool,output_index)
  ); CREATE TABLE IF NOT EXISTS observer_refund_cursor (
    instruction_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS observer_refund_attempt_history (
    expired_txid TEXT PRIMARY KEY, instruction_id TEXT NOT NULL,
    refund_id TEXT NOT NULL, old_fingerprint TEXT NOT NULL, old_memo TEXT NOT NULL,
    replacement_fingerprint TEXT NOT NULL, expiry_height INTEGER NOT NULL,
    wallet_scanned_height INTEGER NOT NULL, checked_tip_height INTEGER NOT NULL,
    checked_tip_hash TEXT NOT NULL, evidence_kind TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`);
  return db;
}
function find(core: SqlitePaymentStore, key: string) {
  return core
    .withdrawalDatabase()
    .prepare("SELECT * FROM observer_record_instructions WHERE source_key=?")
    .get(key) as unknown as Plan | undefined;
}
function source(store: ProductStore, core: SqlitePaymentStore, plan: Plan) {
  const checkout = store.checkout(plan.checkout_id),
    merchant = store.merchant(plan.merchant_id);
  requireValue(
    checkout &&
      checkout.merchantId === plan.merchant_id &&
      merchant?.emailVerifiedAt,
  );
  requireValue(!merchant.wallet && !merchant.destination);
  observerConnection(store, merchant.id);
  const row = store.db
    .prepare("SELECT * FROM merchant_observers WHERE merchant_id=?")
    .get(merchant.id);
  requireValue(
    row?.network === "mainnet" &&
      row.status === "connected" &&
      row.consent_version === "sdk-orchard-view-access-v1",
  );
  const account = store.decrypt(String(row.account)),
    destination = store.decrypt(String(row.destination));
  requireValue(
    uuid.test(account) &&
      addressOnNetwork(destination, "mainnet") &&
      addressOnNetwork(checkout.route, "mainnet"),
  );
  let amount = checkout.amountZat,
    receiver = destination,
    memo = encodeMemo(checkout.order, checkout.route);
  if (plan.kind === "refund") {
    const request = store.refundRequest(plan.request_id!),
      payment = checkout.paymentTxid && core.findByTxid(checkout.paymentTxid);
    requireValue(
      request?.checkoutId === checkout.id &&
        request.status === "approved" &&
        integer(request.approvedZat, 1),
    );
    requireValue(
      payment &&
        payment.merchantId === merchant.id &&
        payment.orderReference === checkout.order &&
        payment.amountZat === checkout.amountZat &&
        payment.refundAddress === checkout.route &&
        payment.status === "confirmed",
    );
    amount = request.approvedZat;
    receiver = checkout.route;
    memo = Buffer.from(store.decrypt(plan.memo)).toString("hex");
  }
  requireValue(integer(amount, 1));
  const fingerprint = store.fingerprint(
    JSON.stringify([
      "observer-output-v1",
      plan.kind,
      merchant.id,
      checkout.id,
      checkout.order,
      checkout.amountZat,
      checkout.paymentTxid,
      checkout.route,
      account,
      row.key_hash,
      row.birthday,
      destination,
      plan.request_id,
      amount,
      receiver,
      memo,
      plan.pool,
      plan.fee_cap,
    ]),
  );
  return { checkout, account, receiver, amount, memo, fingerprint };
}
function savePlan(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  checkoutId: string,
  requestId: string | null,
  pool: Pool,
  feeCap: number,
) {
  const db = dbFor(store, core, merchantId, checkoutId);
  requireValue(
    ["orchard", "ironwood"].includes(pool) &&
      integer(feeCap, requestId ? 1 : 0),
  );
  const key = requestId
    ? `refund:${requestId}`
    : `payment:${checkoutId}:${pool}`;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const existing = find(core, key);
    if (existing) {
      requireValue(
        existing.merchant_id === merchantId &&
          existing.checkout_id === checkoutId &&
          existing.pool === pool &&
          existing.fee_cap === feeCap,
      );
      if (existing.state === "pending")
        requireValue(
          source(store, core, existing).fingerprint === existing.fingerprint,
        );
      store.db.exec("COMMIT");
      return existing;
    }
    const plan: Plan = {
      id: randomUUID(),
      source_key: key,
      kind: requestId ? "refund" : "payment",
      merchant_id: merchantId,
      checkout_id: checkoutId,
      request_id: requestId,
      refund_id: requestId ? `refund_${requestId}` : null,
      fingerprint: "",
      memo: requestId ? store.encrypt(`nostos:refund:${randomUUID()}`) : "",
      pool,
      fee_cap: feeCap,
      txid: null,
      state: "pending",
      handoff_started: 0,
    };
    const expected = source(store, core, plan);
    plan.fingerprint = expected.fingerprint;
    if (requestId) {
      const result = core.prepareRefund(
        expected.checkout.paymentTxid!,
        {
          id: plan.refund_id!,
          paymentId: expected.checkout.paymentTxid!,
          idempotencyKey: plan.refund_id!,
          amountZat: expected.amount,
        },
        true,
      );
      requireValue(
        result.refund.status !== "failed" &&
          result.refund.amountZat === expected.amount,
      );
    }
    // Reservation commits first. An interrupted insert retains the principal;
    // retry recovers the same deterministic refund ID before showing any plan.
    db.prepare(
      `INSERT INTO observer_record_instructions
      (id,source_key,kind,merchant_id,checkout_id,request_id,refund_id,fingerprint,memo,pool,fee_cap)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      plan.id,
      key,
      plan.kind,
      merchantId,
      checkoutId,
      requestId,
      plan.refund_id,
      plan.fingerprint,
      plan.memo,
      pool,
      feeCap,
    );
    store.db.exec("COMMIT");
    return plan;
  } catch {
    store.db.exec("ROLLBACK");
    throw new ObserverRecordError();
  }
}
export async function prepareObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
  feeCapZat: number,
  pool: Pool = "ironwood",
) {
  try {
    requireValue(uuid.test(requestId));
    const request = store.refundRequest(requestId);
    requireValue(request);
    dbFor(store, core, merchantId, request.checkoutId);
    const route = store.checkout(request.checkoutId)!.route;
    requireValue(
      (await orchardRefundReceiver(route, observerWallet(merchantId))) ===
        route,
    );
    const plan = savePlan(
      store,
      core,
      merchantId,
      request.checkoutId,
      requestId,
      pool,
      feeCapZat,
    );
    requireValue(plan.state === "pending");
    const expected = source(store, core, plan);
    return {
      instructionId: plan.id,
      refundId: plan.refund_id!,
      recipient: expected.receiver,
      amountZat: expected.amount,
      memo: store.decrypt(plan.memo),
      pool: plan.pool,
      feeCapZat: plan.fee_cap,
      requiresWalletApproval: true as const,
      reviewOnly: true as const,
      handoffStarted: plan.handoff_started === 1,
    };
  } catch {
    throw new ObserverRecordError();
  }
}
export function claimObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
) {
  let productLocked = false,
    coreLocked = false;
  try {
    const request = store.refundRequest(requestId);
    requireValue(request);
    const db = dbFor(store, core, merchantId, request.checkoutId);
    store.db.exec("BEGIN IMMEDIATE");
    productLocked = true;
    db.exec("BEGIN IMMEDIATE");
    coreLocked = true;
    const plan = find(core, `refund:${requestId}`);
    requireValue(
      plan &&
        plan.merchant_id === merchantId &&
        plan.state === "pending" &&
        !plan.txid &&
        plan.handoff_started === 0,
    );
    const expected = source(store, core, plan);
    requireValue(expected.fingerprint === plan.fingerprint);
    requireValue(core.findRefund(plan.refund_id!)?.status === "pending");
    core.claimRefundBroadcast(expected.checkout.paymentTxid!, plan.refund_id!);
    requireValue(
      db
        .prepare(
          "UPDATE observer_record_instructions SET handoff_started=1 WHERE id=? AND handoff_started=0",
        )
        .run(plan.id).changes === 1,
    );
    db.exec("COMMIT");
    coreLocked = false;
    store.db.exec("COMMIT");
    productLocked = false;
    return {
      instructionId: plan.id,
      refundId: plan.refund_id!,
      recipient: expected.receiver,
      amountZat: expected.amount,
      memo: store.decrypt(plan.memo),
      pool: plan.pool,
      feeCapZat: plan.fee_cap,
      handoffGranted: true as const,
      requiresWalletApproval: true as const,
    };
  } catch {
    if (coreLocked) core.withdrawalDatabase().exec("ROLLBACK");
    if (productLocked) store.db.exec("ROLLBACK");
    throw new ObserverRecordError();
  }
}
export function bindObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
  txid: string,
) {
  try {
    requireValue(hash.test(txid));
    const request = store.refundRequest(requestId);
    requireValue(request);
    const db = dbFor(store, core, merchantId, request.checkoutId),
      plan = find(core, `refund:${requestId}`);
    requireValue(
      plan &&
        plan.merchant_id === merchantId &&
        plan.handoff_started === 1 &&
        (!plan.txid || plan.txid === txid),
    );
    requireValue(plan.state === "pending");
    requireValue(
      !db
        .prepare(
          "SELECT 1 FROM observer_refund_attempt_history WHERE expired_txid=?",
        )
        .get(txid),
    );
    requireValue(source(store, core, plan).fingerprint === plan.fingerprint);
    const result = db
      .prepare(
        "UPDATE observer_record_instructions SET txid=? WHERE id=? AND (txid IS NULL OR txid=?)",
      )
      .run(txid, plan.id, txid);
    requireValue(result.changes === 1);
    // A caller's txid is only a candidate. No broadcast/confirmed status changes.
  } catch {
    throw new ObserverRecordError();
  }
}
type Proof = Record<string, unknown>;
function proofFor(
  raw: unknown,
  plan: Plan,
  expected: ReturnType<typeof source>,
  txid: string,
) {
  requireValue(raw && typeof raw === "object");
  const p = raw as Proof;
  requireValue(
    p.nostos_output_proof_v1 === true &&
      p.network === "mainnet" &&
      p.payments_enabled === false &&
      p.observation_scope === "orchard-family-only" &&
      p.exact_match === true &&
      p.binding === plan.id &&
      p.account_uuid === expected.account &&
      p.txid === txid &&
      p.pool === plan.pool &&
      p.direction === (plan.kind === "payment" ? "incoming" : "outgoing") &&
      p.amount_zat === expected.amount &&
      p.owned_spend === (plan.kind === "refund"),
  );
  requireValue(
    integer(p.height, 1, 0xffffffff) &&
      integer(p.tip_height, p.height, 0xffffffff) &&
      integer(p.confirmations, 3, 0xffffffff) &&
      p.confirmations === p.tip_height - p.height + 1 &&
      integer(p.output_index, 0, 0xffffffff) &&
      typeof p.block_hash === "string" &&
      hash.test(p.block_hash) &&
      typeof p.tip_hash === "string" &&
      hash.test(p.tip_hash),
  );
  requireValue(
    plan.kind === "payment"
      ? p.fee_zat === null
      : integer(p.fee_zat, 0, plan.fee_cap),
  );
  // No receiver, paying memo, viewing key or account ID is duplicated here.
  return {
    txid,
    pool: plan.pool,
    output_index: p.output_index as number,
    height: p.height as number,
    block_hash: p.block_hash,
    tip_height: p.tip_height,
    tip_hash: p.tip_hash,
    confirmations: p.confirmations as number,
    fee_zat: p.fee_zat,
  };
}
function project(store: ProductStore, core: SqlitePaymentStore, plan: Plan) {
  const checkout = store.checkout(plan.checkout_id);
  requireValue(checkout?.merchantId === plan.merchant_id);
  if (plan.kind === "payment") {
    requireValue(
      plan.txid &&
        (!checkout.paymentTxid || checkout.paymentTxid === plan.txid),
    );
    const payment = core.findByTxid(plan.txid);
    requireValue(
      payment?.merchantId === plan.merchant_id &&
        payment.orderReference === checkout.order &&
        payment.amountZat === checkout.amountZat,
    );
    store.recordPayment(checkout.id, plan.txid);
    store.paid(checkout.id);
  } else {
    const refund = core.findRefund(plan.refund_id!),
      request = store.refundRequest(plan.request_id!);
    requireValue(
      refund?.status === "confirmed" &&
        refund.paymentId === checkout.paymentTxid &&
        refund.txid === plan.txid &&
        request?.checkoutId === checkout.id &&
        ["approved", "settled"].includes(request.status) &&
        request.approvedZat === refund.amountZat,
    );
    store.settleRefundRequest(request.id);
    const totals = core.refundTotals(refund.paymentId);
    if (
      !totals.inProgress &&
      totals.refundedZat >= checkout.amountZat &&
      core.retireConfirmedRefundRoute(refund.paymentId)
    )
      store.retireRoute(checkout.id);
  }
}
function finish(store: ProductStore, core: SqlitePaymentStore, plan: Plan) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    project(store, core, plan);
    store.db.exec("COMMIT");
  } catch {
    store.db.exec("ROLLBACK");
    throw new ObserverRecordError();
  }
  core
    .withdrawalDatabase()
    .prepare(
      "UPDATE observer_record_instructions SET state='applied' WHERE id=?",
    )
    .run(plan.id);
  return checkoutView(store, core, store.checkout(plan.checkout_id)!);
}
async function verifyAndApply(
  store: ProductStore,
  core: SqlitePaymentStore,
  plan: Plan,
  txid: string,
) {
  const db = dbFor(store, core, plan.merchant_id, plan.checkout_id);
  requireValue(hash.test(txid) && (!plan.txid || plan.txid === txid));
  requireValue(
    !db
      .prepare(
        "SELECT 1 FROM observer_refund_attempt_history WHERE expired_txid=?",
      )
      .get(txid),
  );
  if (plan.state !== "pending") return finish(store, core, plan);
  const expected = source(store, core, plan);
  requireValue(expected.fingerprint === plan.fingerprint);
  const raw = await observerWallet(plan.merchant_id).call<unknown>(
    "nostos_verify_output",
    [
      expected.account,
      txid,
      expected.receiver,
      expected.amount,
      expected.memo,
      plan.pool,
      plan.kind === "payment" ? "incoming" : "outgoing",
      plan.id,
      plan.fee_cap,
    ],
  );
  const proof = proofFor(raw, plan, expected, txid);
  let productActive = false,
    coreActive = false;
  try {
    // Fixed lock order. The journal and core accounting commit together; the
    // second DB projection can then be replayed after a process interruption.
    store.db.exec("BEGIN IMMEDIATE");
    productActive = true;
    db.exec("BEGIN IMMEDIATE");
    coreActive = true;
    const current = find(core, plan.source_key);
    requireValue(current && (!current.txid || current.txid === txid));
    if (current.state !== "pending") {
      db.exec("COMMIT");
      coreActive = false;
      store.db.exec("COMMIT");
      productActive = false;
      return finish(store, core, current);
    }
    const refreshed = source(store, core, current);
    requireValue(refreshed.fingerprint === plan.fingerprint);
    db.prepare("INSERT INTO observer_output_claims VALUES(?,?,?,?)").run(
      txid,
      plan.pool,
      proof.output_index,
      plan.id,
    );
    if (plan.kind === "payment") {
      requireValue(
        !refreshed.checkout.paymentTxid ||
          refreshed.checkout.paymentTxid === txid,
      );
      core.insertPayment({
        id: txid,
        paymentTxId: txid,
        merchantId: plan.merchant_id,
        orderReference: expected.checkout.order,
        amountZat: expected.amount,
        refundAddress: expected.checkout.route,
        confirmations: proof.confirmations,
        status: "confirmed",
      });
      db.prepare(
        "UPDATE payments SET confirmations=?,status='confirmed' WHERE id=? AND status IN ('confirmed','detected')",
      ).run(proof.confirmations, txid);
    } else {
      const refund = core.findRefund(plan.refund_id!);
      requireValue(
        refund &&
          refund.paymentId === expected.checkout.paymentTxid &&
          refund.amountZat === expected.amount &&
          refund.status !== "failed" &&
          (!refund.txid || refund.txid === txid),
      );
      db.prepare(
        "UPDATE refund_events SET status='confirmed',txid=?,updated_at=? WHERE id=?",
      ).run(txid, new Date().toISOString(), refund.id);
      db.prepare(
        "UPDATE refunds SET status='confirmed',txid=?,updated_at=? WHERE id=?",
      ).run(txid, new Date().toISOString(), refund.id);
    }
    db.prepare(
      "UPDATE observer_record_instructions SET txid=?,proof=?,state='core_applied' WHERE id=?",
    ).run(txid, store.encrypt(JSON.stringify(proof)), plan.id);
    db.exec("COMMIT");
    coreActive = false;
    project(store, core, { ...plan, txid, state: "core_applied" });
    store.db.exec("COMMIT");
    productActive = false;
    db.prepare(
      "UPDATE observer_record_instructions SET state='applied' WHERE id=?",
    ).run(plan.id);
    return checkoutView(store, core, store.checkout(plan.checkout_id)!);
  } catch {
    if (coreActive) db.exec("ROLLBACK");
    if (productActive) store.db.exec("ROLLBACK");
    throw new ObserverRecordError();
  }
}
export async function reconcileObservedPayment(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  checkoutId: string,
  txid: string,
  pool: Pool = "ironwood",
) {
  try {
    return await verifyAndApply(
      store,
      core,
      savePlan(store, core, merchantId, checkoutId, null, pool, 0),
      txid,
    );
  } catch {
    throw new ObserverRecordError();
  }
}
export type ExpiredRefundEvidence = {
  txid: string;
  memo: string;
  amountZat: number;
  feeZat: number;
  expiryHeight: number;
  walletScannedHeight: number;
  minedHeight: null;
  walletStatus: "expired";
  operatorReviewed: true;
};

// Private operator recovery ONLY. No HTTP route accepts this evidence. The
// operator reviews a local wallet export; it is not a cryptographic expiry proof.
// Never infer expiry from a timeout, missing candidate or missing mempool entry.
export async function recoverExpiredObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
  evidence: ExpiredRefundEvidence,
  apply = false,
  chain: Pick<ZalletRpcClient, "call"> = chainWallet(),
) {
  requireValue(uuid.test(merchantId) && uuid.test(requestId));
  requireValue(
    evidence &&
      Object.keys(evidence).sort().join(",") ===
        "amountZat,expiryHeight,feeZat,memo,minedHeight,operatorReviewed,txid,walletScannedHeight,walletStatus",
  );
  requireValue(
    hash.test(evidence.txid) &&
      evidence.operatorReviewed === true &&
      evidence.walletStatus === "expired" &&
      evidence.minedHeight === null &&
      integer(evidence.expiryHeight, 1, 0xffffffff - 100) &&
      integer(
        evidence.walletScannedHeight,
        evidence.expiryHeight + 100,
        0xffffffff,
      ) &&
      integer(evidence.amountZat, 1) &&
      integer(evidence.feeZat, 1) &&
      /^nostos:refund:[a-f0-9-]{36}$/.test(evidence.memo),
  );
  const request = store.refundRequest(requestId);
  requireValue(request);
  const db = dbFor(store, core, merchantId, request.checkoutId);
  const plan = find(core, `refund:${requestId}`);
  requireValue(plan?.merchant_id === merchantId && plan.kind === "refund");
  const previous = db
    .prepare(
      "SELECT * FROM observer_refund_attempt_history WHERE expired_txid=?",
    )
    .get(evidence.txid);
  if (previous) {
    requireValue(
      previous.instruction_id === plan.id &&
        previous.refund_id === plan.refund_id &&
        previous.expiry_height === evidence.expiryHeight &&
        store.decrypt(String(previous.old_memo)) === evidence.memo,
    );
    return {
      recovered: true,
      alreadyRecovered: true,
      sendsRequested: 0,
      reservationPreserved: true,
      evidenceKind: "operator_reviewed_wallet_export_v1",
    };
  }
  const expected = source(store, core, plan);
  const refund = core.findRefund(plan.refund_id!);
  requireValue(
    plan.state === "pending" &&
      plan.handoff_started === 1 &&
      (!plan.txid || plan.txid === evidence.txid) &&
      expected.fingerprint === plan.fingerprint &&
      store.decrypt(plan.memo) === evidence.memo &&
      evidence.amountZat === expected.amount &&
      evidence.feeZat <= plan.fee_cap &&
      refund &&
      ["broadcasting", "broadcast_unknown", "broadcast"].includes(
        refund.status,
      ) &&
      (!refund.txid || refund.txid === evidence.txid) &&
      refund.amountZat === expected.amount,
  );
  requireValue(
    !db
      .prepare(
        "SELECT 1 FROM observer_output_claims WHERE txid=? OR instruction_id=?",
      )
      .get(evidence.txid, plan.id),
  );
  const info = await chain.call<{
    chain: string;
    blocks: number;
    bestblockhash: string;
  }>("getblockchaininfo", []);
  requireValue(
    info.chain === "main" &&
      integer(info.blocks, evidence.walletScannedHeight, 0xffffffff) &&
      info.blocks >= evidence.expiryHeight + 100 &&
      hash.test(info.bestblockhash),
  );
  // Any returned raw transaction blocks recovery, regardless of confirmations.
  let missing = false;
  try {
    await chain.call("getrawtransaction", [evidence.txid]);
  } catch (error) {
    missing = error instanceof Error && /failed \(-5\)\.$/.test(error.message);
  }
  requireValue(missing);
  const mempool = await chain.call<unknown>("getrawmempool", []);
  requireValue(
    Array.isArray(mempool) &&
      mempool.every((id) => typeof id === "string" && hash.test(id)) &&
      !mempool.includes(evidence.txid),
  );
  const status = await observerWallet(merchantId).call<Record<string, unknown>>(
    "getwalletstatus",
    [],
  );
  const tip = status.node_tip as
    | { height?: number; blockhash?: string }
    | undefined;
  const walletTip = status.wallet_tip as
    | { height?: number; blockhash?: string }
    | undefined;
  requireValue(
    status.locked === false &&
      status.account_connected === true &&
      status.fully_synced_height === info.blocks &&
      tip?.height === info.blocks &&
      walletTip?.height === info.blocks &&
      tip.blockhash === info.bestblockhash &&
      walletTip.blockhash === info.bestblockhash,
  );
  const currentChain = await chain.call<typeof info>("getblockchaininfo", []);
  requireValue(
    currentChain.chain === info.chain &&
      currentChain.blocks === info.blocks &&
      currentChain.bestblockhash === info.bestblockhash,
  );
  const report = {
    recovered: false,
    ready: true,
    evidenceKind: "operator_reviewed_wallet_export_v1",
    expiryHeight: evidence.expiryHeight,
    checkedTipHeight: info.blocks,
    amountZat: expected.amount,
    reservationPreserved: true,
    sendsRequested: 0,
  };
  if (!apply) return report;
  let productLocked = false,
    coreLocked = false;
  try {
    store.db.exec("BEGIN IMMEDIATE");
    productLocked = true;
    db.exec("BEGIN IMMEDIATE");
    coreLocked = true;
    const current = find(core, plan.source_key);
    const currentRefund = core.findRefund(plan.refund_id!);
    requireValue(
      current &&
        current.state === "pending" &&
        current.handoff_started === 1 &&
        current.fingerprint === plan.fingerprint &&
        current.memo === plan.memo &&
        current.txid === plan.txid &&
        source(store, core, current).fingerprint === plan.fingerprint &&
        currentRefund &&
        currentRefund.status === refund.status &&
        currentRefund.txid === refund.txid &&
        currentRefund.amountZat === expected.amount &&
        !db
          .prepare(
            "SELECT 1 FROM observer_output_claims WHERE txid=? OR instruction_id=?",
          )
          .get(evidence.txid, plan.id),
    );
    const replacement = {
      ...current,
      memo: store.encrypt(`nostos:refund:${randomUUID()}`),
      txid: null,
      handoff_started: 0,
    };
    replacement.fingerprint = source(store, core, replacement).fingerprint;
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO observer_refund_attempt_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      evidence.txid,
      plan.id,
      plan.refund_id,
      plan.fingerprint,
      plan.memo,
      replacement.fingerprint,
      evidence.expiryHeight,
      evidence.walletScannedHeight,
      info.blocks,
      info.bestblockhash,
      "operator_reviewed_wallet_export_v1",
      now,
    );
    requireValue(
      db
        .prepare(
          "UPDATE refund_events SET status='pending',txid=NULL,retry_count=retry_count+1,updated_at=? WHERE id=? AND status=?",
        )
        .run(now, plan.refund_id, refund.status).changes === 1,
    );
    db.prepare(
      "UPDATE refunds SET status='pending',txid=NULL,retry_count=retry_count+1,updated_at=? WHERE id=?",
    ).run(now, plan.refund_id);
    requireValue(
      db
        .prepare(
          "UPDATE observer_record_instructions SET memo=?,fingerprint=?,txid=NULL,handoff_started=0,proof='' WHERE id=? AND state='pending' AND handoff_started=1 AND fingerprint=?",
        )
        .run(
          replacement.memo,
          replacement.fingerprint,
          plan.id,
          plan.fingerprint,
        ).changes === 1,
    );
    db.prepare("DELETE FROM observer_refund_cursor WHERE instruction_id=?").run(
      plan.id,
    );
    db.exec("COMMIT");
    coreLocked = false;
    store.db.exec("COMMIT");
    productLocked = false;
    return { ...report, recovered: true, freshWalletApprovalRequired: true };
  } catch {
    if (coreLocked) db.exec("ROLLBACK");
    if (productLocked) store.db.exec("ROLLBACK");
    throw new ObserverRecordError();
  }
}

// One durable instruction per dashboard refresh, oldest checked first. No sends.
export async function reconcileMerchantRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
) {
  const db = core.withdrawalDatabase();
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='observer_record_instructions'",
      )
      .get()
  )
    return;
  db.exec(
    "CREATE TABLE IF NOT EXISTS observer_refund_checks (instruction_id TEXT PRIMARY KEY, code TEXT NOT NULL, checked_at TEXT NOT NULL)",
  );
  const plan = db
    .prepare(
      "SELECT i.request_id FROM observer_record_instructions i LEFT JOIN observer_refund_checks c ON c.instruction_id=i.id WHERE i.merchant_id=? AND i.kind='refund' AND i.handoff_started=1 AND i.state!='applied' ORDER BY COALESCE(c.checked_at,''),i.id LIMIT 1",
    )
    .get(merchantId);
  if (plan) {
    const instruction = db
      .prepare("SELECT id FROM observer_record_instructions WHERE source_key=?")
      .get(`refund:${String(plan.request_id)}`);
    if (instruction)
      recordRefundCheck(core, String(instruction.id), "checking");
    try {
      await reconcileObservedRefund(
        store,
        core,
        merchantId,
        String(plan.request_id),
      );
    } catch {
      /* The per-refund check state explains unresolved verification. */
    }
  }
}
const refundChecks = new Set<string>();
function recordRefundCheck(
  core: SqlitePaymentStore,
  instructionId: string,
  code: RefundCheckCode,
) {
  const db = core.withdrawalDatabase();
  db.exec(
    "CREATE TABLE IF NOT EXISTS observer_refund_checks (instruction_id TEXT PRIMARY KEY, code TEXT NOT NULL, checked_at TEXT NOT NULL)",
  );
  db.prepare(
    "INSERT INTO observer_refund_checks VALUES(?,?,?) ON CONFLICT(instruction_id) DO UPDATE SET code=excluded.code,checked_at=excluded.checked_at",
  ).run(instructionId, code, new Date().toISOString());
}
async function explainBoundRefund(
  merchantId: string,
  txid: string,
): Promise<RefundCheckCode> {
  try {
    const status = await observerWallet(merchantId).call<
      Record<string, unknown>
    >("getwalletstatus", []);
    const tip = status.node_tip as { height?: number } | undefined;
    if (
      status.locked !== false ||
      status.account_connected !== true ||
      status.fully_synced_height !== tip?.height
    )
      return "observer_syncing";
    try {
      const tx = await chainWallet().call<{ confirmations?: number }>(
        "getrawtransaction",
        [txid, 1],
      );
      if (!Number.isSafeInteger(tx.confirmations))
        return "observer_unavailable";
      return tx.confirmations! < 3 ? "confirming" : "output_unverified";
    } catch (error) {
      return error instanceof Error && /failed \(-5\)\.$/.test(error.message)
        ? "transaction_unseen"
        : "observer_unavailable";
    }
  } catch {
    return "observer_unavailable";
  }
}
export async function reconcileObservedRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
) {
  const key = merchantId + ":" + requestId;
  if (refundChecks.has(key)) throw new ObserverRecordError("checking");
  refundChecks.add(key);
  try {
    return await reconcileRefund(store, core, merchantId, requestId);
  } catch (error) {
    const plan = find(core, `refund:${requestId}`);
    if (
      plan?.merchant_id === merchantId &&
      plan.state === "pending" &&
      plan.handoff_started === 1
    )
      recordRefundCheck(
        core,
        plan.id,
        error instanceof ObserverRecordError && error.code
          ? error.code
          : "observer_unavailable",
      );
    throw error;
  } finally {
    refundChecks.delete(key);
  }
}
async function reconcileRefund(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
  requestId: string,
) {
  try {
    const request = store.refundRequest(requestId);
    requireValue(request);
    dbFor(store, core, merchantId, request.checkoutId);
    const plan = find(core, `refund:${requestId}`);
    requireValue(
      plan?.merchant_id === merchantId && plan.handoff_started === 1,
    );
    if (plan.txid) {
      try {
        return await verifyAndApply(store, core, plan, plan.txid);
      } catch {
        const code = await explainBoundRefund(merchantId, plan.txid);
        recordRefundCheck(core, plan.id, code);
        throw new ObserverRecordError(code);
      }
    }
    const expected = source(store, core, plan);
    requireValue(expected.fingerprint === plan.fingerprint);
    const db = core.withdrawalDatabase();
    db.exec(
      "CREATE TABLE IF NOT EXISTS observer_refund_cursor (instruction_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL)",
    );
    const cursor = Number(
      db
        .prepare(
          "SELECT cursor FROM observer_refund_cursor WHERE instruction_id=?",
        )
        .get(plan.id)?.cursor ?? 0,
    );
    const result = await observerWallet(merchantId).call<{
      candidates: unknown;
    }>("nostos_outgoing_candidates", [expected.account, cursor]);
    requireValue(
      Array.isArray(result.candidates) && result.candidates.length <= 4,
    );
    let next = cursor;
    for (const row of result.candidates as unknown[]) {
      requireValue(
        Array.isArray(row) &&
          row.length === 2 &&
          integer(row[0], next + 1) &&
          typeof row[1] === "string" &&
          hash.test(row[1]),
      );
      next = row[0];
      try {
        return await verifyAndApply(store, core, plan, row[1]);
      } catch {
        /* Keep reservation; a candidate is never send evidence. */
      }
    }
    db.prepare(
      "INSERT INTO observer_refund_cursor VALUES(?,?) ON CONFLICT(instruction_id) DO UPDATE SET cursor=excluded.cursor",
    ).run(plan.id, result.candidates.length < 4 ? 0 : next);
    recordRefundCheck(core, plan.id, "awaiting_detection");
    throw new ObserverRecordError("awaiting_detection");
  } catch (error) {
    if (error instanceof ObserverRecordError) throw error;
    throw new ObserverRecordError("observer_unavailable");
  }
}

// Only the server sees candidate references. Exact native output proof remains
// the sole authority for credit, including candidates from spent incoming notes.
const incomingScans = new Map<string, Promise<void>>();
export async function detectObservedPayment(
  store: ProductStore,
  core: SqlitePaymentStore,
  checkoutId: string,
) {
  const checkout = store.checkout(checkoutId);
  if (!checkout?.route || checkout.status !== "unpaid") return;
  const key = checkout.merchantId;
  if (incomingScans.has(key)) return;
  const scan = (async () => {
    const plan = savePlan(store, core, key, checkoutId, null, "ironwood", 0);
    const expected = source(store, core, plan);
    const db = core.withdrawalDatabase();
    db.exec(
      "CREATE TABLE IF NOT EXISTS observer_incoming_cursor (checkout_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL)",
    );
    const cursor = Number(
      db
        .prepare(
          "SELECT cursor FROM observer_incoming_cursor WHERE checkout_id=?",
        )
        .get(checkoutId)?.cursor ?? 0,
    );
    const result = await observerWallet(key).call<{ candidates: unknown }>(
      "nostos_incoming_candidates",
      [expected.account, cursor],
    );
    requireValue(
      Array.isArray(result.candidates) && result.candidates.length <= 4,
    );
    let next = cursor;
    for (const row of result.candidates as unknown[]) {
      requireValue(
        Array.isArray(row) &&
          row.length === 2 &&
          integer(row[0], next + 1) &&
          typeof row[1] === "string" &&
          hash.test(row[1]),
      );
      next = row[0];
      for (const pool of ["ironwood", "orchard"] as const) {
        try {
          await reconcileObservedPayment(
            store,
            core,
            key,
            checkoutId,
            row[1],
            pool,
          );
          return;
        } catch {
          // Unconfirmed, unrelated and mismatched candidates never earn credit.
        }
      }
    }
    db.prepare(
      "INSERT INTO observer_incoming_cursor VALUES(?,?) ON CONFLICT(checkout_id) DO UPDATE SET cursor=excluded.cursor",
    ).run(checkoutId, result.candidates.length < 4 ? 0 : next);
  })();
  incomingScans.set(key, scan);
  try {
    await scan;
  } finally {
    if (incomingScans.get(key) === scan) incomingScans.delete(key);
  }
}
