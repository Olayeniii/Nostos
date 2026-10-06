// No migrations, decryption, RPC or spending. Inspect one existing checkout only.
import { DatabaseSync } from "node:sqlite";

const report = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const checkoutId = process.argv[2];
let product, core;
try {
  if (!/^[a-f0-9-]{36}$/.test(checkoutId ?? "")) throw new Error();
  const productPath = process.env.NOSTOS_PRODUCT_DATABASE_PATH;
  const corePath = process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH;
  if (!productPath || !corePath) throw new Error();
  product = new DatabaseSync(productPath, { readOnly: true });
  core = new DatabaseSync(corePath, { readOnly: true });
  product.exec("BEGIN");
  core.exec("BEGIN");
  const checkout = product
    .prepare(
      `SELECT id, amount_zat, status, payment_txid,
    refund_expires_at, route_closed_reason, route<>'' AS route_present
    FROM checkouts WHERE id=?`,
    )
    .get(checkoutId);
  if (!checkout?.payment_txid) throw new Error();
  const payment = core
    .prepare(
      `SELECT id,amount_zat,confirmations,status,
    refund_address<>'' AS route_present FROM payments WHERE payment_txid=?`,
    )
    .get(checkout.payment_txid);
  if (!payment || payment.amount_zat !== checkout.amount_zat) throw new Error();
  const hasLedger = core
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='refund_events'",
    )
    .get();
  // Legacy releases have one refund. Do not migrate or double-count that mirror.
  const table = hasLedger ? "refund_events" : "refunds";
  const refunds = core
    .prepare(
      `SELECT id,amount_zat,status,txid,retry_count,created_at,updated_at
    FROM ${table} WHERE payment_id=? ORDER BY created_at,id`,
    )
    .all(payment.id);
  const openRequests = product
    .prepare(
      `SELECT COUNT(*) AS count FROM refund_requests
    WHERE checkout_id=? AND status IN ('requested','approved')`,
    )
    .get(checkoutId).count;
  const confirmed = refunds
    .filter((r) => r.status === "confirmed")
    .reduce((sum, r) => sum + r.amount_zat, 0);
  const reserved = refunds
    .filter((r) => r.status !== "confirmed")
    .reduce((sum, r) => sum + r.amount_zat, 0);
  const expiry = Date.parse(checkout.refund_expires_at ?? "");
  const expired = Number.isFinite(expiry) && expiry <= Date.now();
  const unresolved = refunds.some((r) => r.status !== "confirmed");
  const reason = unresolved
    ? "unresolved_refund"
    : openRequests
      ? "open_customer_request"
      : confirmed >= checkout.amount_zat
        ? "fully_refunded"
        : expired
          ? "window_expired"
          : !Number.isFinite(expiry)
            ? "expiry_not_recorded"
            : "remaining_refund_capability";
  const shouldRetire =
    reason === "fully_refunded" || reason === "window_expired";
  const routePresent = !!checkout.route_present || !!payment.route_present;
  const retirementState = shouldRetire
    ? routePresent
      ? "due"
      : "retired"
    : routePresent
      ? "retained"
      : "absent_requires_review";
  report({
    read_only: true,
    checkout_id: checkout.id,
    payment_id: payment.id,
    payment_txid: checkout.payment_txid,
    amount_zat: checkout.amount_zat,
    payment_status: checkout.status,
    payment_confirmations: payment.confirmations,
    refunds,
    confirmed_refund_zat: confirmed,
    reserved_refund_zat: reserved,
    remaining_payment_value_zat: checkout.amount_zat - confirmed,
    available_refund_value_zat: checkout.amount_zat - confirmed - reserved,
    open_request_count: openRequests,
    refund_expires_at: checkout.refund_expires_at,
    product_route_present: !!checkout.route_present,
    core_route_present: !!payment.route_present,
    route_closed_reason: ["refunded", "expired"].includes(
      checkout.route_closed_reason,
    )
      ? checkout.route_closed_reason
      : checkout.route_closed_reason
        ? "unrecognized"
        : null,
    retention_reason: reason,
    retirement_state: retirementState,
    retention_config_enabled: process.env.NOSTOS_RETENTION_ENABLED !== "0",
    scope:
      "Separate read-only database snapshots may differ during concurrent updates; not wallet/on-chain verification or proof the retention timer ran. No route, memo, receipt capability, merchant data or keys are read.",
  });
} catch {
  report({ read_only: true, inspection_failed: true });
  process.exitCode = 1;
} finally {
  core?.close();
  product?.close();
}
