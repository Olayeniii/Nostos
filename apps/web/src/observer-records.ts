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
  constructor() {
    super(
      "Observer reconciliation is unresolved. Keep the saved instruction and transaction; do not send again.",
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
export async function reconcileObservedRefund(
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
    requireValue(plan?.merchant_id === merchantId && plan.txid);
    return await verifyAndApply(store, core, plan, plan.txid);
  } catch {
    throw new ObserverRecordError();
  }
}
