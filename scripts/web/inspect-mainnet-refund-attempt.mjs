// Read-only correlation of the reported ZODL attempt with NOSTOS's durable ledger.
// No migrations, RPC, transaction construction, retries or reservation changes.
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
import { pathToFileURL } from "node:url";

export function inspectAttempt({ productPath, corePath, key, txid, memo }) {
  if (
    !/^[a-f0-9]{64}$/.test(key ?? "") ||
    !/^[a-f0-9]{64}$/.test(txid ?? "") ||
    !/^nostos:refund:[a-f0-9-]{36}$/.test(memo ?? "")
  )
    throw Error("Invalid inspection fields");
  const decode = (value) => {
    const parts = value.split(".");
    if (parts.length !== 3) throw Error("Invalid stored memo");
    const [nonce, tag, body] = parts.map((part) =>
      Buffer.from(part, "base64url"),
    );
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      nonce,
    );
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]).toString(
      "utf8",
    );
  };
  let product, core;
  try {
    product = new DatabaseSync(productPath, { readOnly: true });
    core = new DatabaseSync(corePath, { readOnly: true });
    for (const db of [product, core]) {
      db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");
    }
    const plans = core
      .prepare(
        "SELECT * FROM observer_record_instructions WHERE kind='refund' LIMIT 101",
      )
      .all();
    if (plans.length > 100) throw Error("Inspection scope exceeded");
    const matches = plans.filter((plan) => decode(plan.memo) === memo);
    const result = {
      read_only: true,
      matching_instructions: matches.length,
      sends_requested: 0,
      retry_authorized: false,
    };
    if (matches.length !== 1) return result;
    const plan = matches[0];
    const request = product
      .prepare("SELECT * FROM refund_requests WHERE id=?")
      .get(plan.request_id);
    const checkout = product
      .prepare("SELECT * FROM checkouts WHERE id=?")
      .get(plan.checkout_id);
    const refund = core
      .prepare("SELECT * FROM refund_events WHERE id=?")
      .get(plan.refund_id);
    const payment =
      checkout?.payment_txid &&
      core
        .prepare("SELECT * FROM payments WHERE payment_txid=?")
        .get(checkout.payment_txid);
    return {
      ...result,
      instruction_state: plan.state,
      handoff_started: plan.handoff_started === 1,
      transaction_bound: Boolean(plan.txid),
      bound_transaction_matches_report: plan.txid ? plan.txid === txid : null,
      fee_cap_zat: plan.fee_cap,
      reported_fee_within_cap: 10000 <= plan.fee_cap,
      request_state: request?.status ?? null,
      approved_amount_zat: request?.approved_zat ?? null,
      refund_state: refund?.status ?? null,
      reserved_amount_zat:
        refund && !["failed", "confirmed"].includes(refund.status)
          ? refund.amount_zat
          : 0,
      refund_created_at: refund?.created_at ?? null,
      refund_updated_at: refund?.updated_at ?? null,
      payment_state: payment?.status ?? null,
      payment_amount_zat: payment?.amount_zat ?? null,
      payment_recorded_at: checkout?.paid_at ?? null,
      refund_request_created_at: request?.created_at ?? null,
      refund_request_decided_at: request?.decided_at ?? null,
      saved_fields_consistent: Boolean(
        request &&
          checkout &&
          refund &&
          payment &&
          request.checkout_id === checkout.id &&
          plan.merchant_id === checkout.merchant_id &&
          payment.merchant_id === checkout.merchant_id &&
          refund.payment_id === payment.id &&
          request.approved_zat === refund.amount_zat &&
          refund.amount_zat === 50000 &&
          checkout.amount_zat === payment.amount_zat,
      ),
      submission_owner: "external_wallet",
      nostos_retains_external_submission_response: false,
    };
  } finally {
    core?.close();
    product?.close();
  }
}

if (
  process.argv[1] &&
  (process.argv[1] === "-" ||
    import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  try {
    const { productConfiguration } = await import(
      "/app/packages/network/src/index.ts"
    );
    const config = productConfiguration();
    console.log(
      JSON.stringify(
        inspectAttempt({
          productPath: config.path,
          corePath: config.corePath,
          key: config.key,
          txid: "da165bc6333903a4954e2e2b9b297e2b249f5b0c5adf7315616de926b113aa92",
          memo: "nostos:refund:f1be282d-30b6-43e7-8c28-e7d7df9d62f7",
        }),
      ),
    );
  } catch {
    console.log(
      JSON.stringify({
        read_only: true,
        inspection_failed: true,
        sends_requested: 0,
        retry_authorized: false,
      }),
    );
    process.exitCode = 1;
  }
}
