// Operator-only recovery. No send method, deletion, route retirement or HTTP API.
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const fixture = Object.freeze({
  checkout: "27f5da23-15d3-4c5d-8d1f-3f253872cc5a",
  payment: "6f692f8c99d355f9a1d3ddf99a76df1cdaf3f81bbc07a14db7d460c838f9c91e",
  confirmed: "ad7ff94e16ba2793d2831166d9dcfe6ebaf045856db2aa56808db55134965272",
  refund: "refund_dbd484d2-f75c-43d8-a63f-5f3a6c3e0250",
  created: "2026-10-11T15:39:25.385Z",
});
const anchorTime = Math.ceil(Date.parse(fixture.created) / 1000) + 86400;
export const auditSchema = `CREATE TABLE IF NOT EXISTS refund_resolutions (
  refund_id TEXT PRIMARY KEY REFERENCES refund_events(id),
  payment_id TEXT NOT NULL REFERENCES payments(id), resolution TEXT NOT NULL,
  evidence_json TEXT NOT NULL, created_at TEXT NOT NULL)`;
function requireCheck(ok) {
  if (!ok)
    throw new Error("Reconciliation evidence or current state did not pass.");
}
function decrypt(value, key) {
  requireCheck(typeof value === "string" && value.split(".").length === 3);
  const [nonce, tag, body] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    nonce,
  );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
function state(product, core) {
  const checkout = product
    .prepare(
      `SELECT c.id,c.merchant_id,c.payment_txid,c.amount_zat,c.route,c.order_ref,m.wallet
    FROM checkouts c JOIN merchants m ON m.id=c.merchant_id WHERE c.id=?`,
    )
    .get(fixture.checkout);
  const payment = core
    .prepare(
      `SELECT id,merchant_id,payment_txid,amount_zat,refund_address,status,order_reference
    FROM payments WHERE payment_txid=?`,
    )
    .get(fixture.payment);
  const refunds = core
    .prepare(
      `SELECT id,payment_id,amount_zat,status,txid,retry_count,created_at,updated_at
    FROM refund_events WHERE payment_id=? ORDER BY created_at,id`,
    )
    .all(fixture.payment);
  const hasAudit = core
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='refund_resolutions'",
    )
    .get();
  const audit = hasAudit
    ? core
        .prepare("SELECT resolution FROM refund_resolutions WHERE refund_id=?")
        .get(fixture.refund)
    : undefined;
  return { checkout, payment, refunds, audit };
}
export function validateProof(proof, status, now = Date.now()) {
  requireCheck(proof?.walletVersion === "0.1.0-beta.3");
  requireCheck(
    Number.isFinite(proof.observedAt) &&
      now - proof.observedAt >= -5000 &&
      now - proof.observedAt <= 60000,
  );
  const m = proof.matchingAccount;
  requireCheck(
    m?.available === true &&
      m.transaction_count === 2 &&
      m.other_transaction_count === 0 &&
      m.other_unmined_count === 0 &&
      m.invalid_txid_count === 0,
  );
  requireCheck(
    m.known_transaction_matches?.payment === 1 &&
      m.known_transaction_matches?.confirmed_refund === 1,
  );
  requireCheck(
    m.nonchange_orchard_family_200000_zat_send_transaction_count === 0,
  );
  const a = proof.expiryAnchor;
  requireCheck(
    Number.isSafeInteger(a?.height) &&
      a.height > 0 &&
      Number.isSafeInteger(a?.time) &&
      a.time >= anchorTime,
  );
  requireCheck(
    Number.isSafeInteger(proof.latestStoredBlock) &&
      proof.latestStoredBlock > a.height + 41,
  );
  const tip = status?.node_tip,
    wallet = status?.wallet_tip;
  requireCheck(
    Number.isSafeInteger(tip?.height) &&
      tip.height > a.height + 41 &&
      tip.height >= proof.latestStoredBlock,
  );
  requireCheck(
    wallet?.height === tip.height &&
      status.fully_synced_height === tip.height &&
      status.locked === false,
  );
  requireCheck(
    typeof tip.blockhash === "string" &&
      /^[a-f0-9]{64}$/i.test(tip.blockhash) &&
      wallet.blockhash === tip.blockhash,
  );
  requireCheck(
    status.sync_work_remaining == null ||
      status.sync_work_remaining.unscanned_blocks === 0,
  );
  requireCheck(
    typeof proof.accountUuid === "string" &&
      /^[a-f0-9-]{36}$/i.test(proof.accountUuid),
  );
}

export async function reconcileItem21({
  productPath,
  corePath,
  key,
  rpc,
  verifyRoute,
  decodePaymentMemo,
  proof,
  apply = false,
  capability = 0,
  now = Date.now(),
}) {
  requireCheck(
    capability === 1 &&
      typeof verifyRoute === "function" &&
      typeof decodePaymentMemo === "function" &&
      /^[a-f0-9]{64}$/.test(key ?? ""),
  );
  const status = await rpc.call("getwalletstatus");
  validateProof(proof, status, now);
  const product = new DatabaseSync(productPath, { readOnly: true });
  const core = new DatabaseSync(corePath, { readOnly: !apply });
  let transaction = false;
  try {
    const before = state(product, core);
    const { checkout: c, payment: p, refunds } = before;
    requireCheck(
      c?.payment_txid === fixture.payment &&
        c.amount_zat === 2000000 &&
        p?.id === fixture.payment &&
        p.payment_txid === fixture.payment &&
        p.amount_zat === 2000000 &&
        p.status === "confirmed" &&
        p.merchant_id === c.merchant_id,
    );
    requireCheck(decrypt(c.wallet, key) === proof.accountUuid);
    const route = decrypt(c.route, key);
    const order = decrypt(c.order_ref, key);
    requireCheck(
      route.length > 0 &&
        decrypt(p.refund_address, key) === route &&
        decrypt(p.order_reference, key) === order,
    );
    await verifyRoute(route, rpc);
    const prior = refunds.find((r) => r.txid === fixture.confirmed);
    const target = refunds.find((r) => r.id === fixture.refund);
    requireCheck(
      refunds.length === 2 &&
        prior?.status === "confirmed" &&
        prior.amount_zat === 1800000 &&
        target?.amount_zat === 200000 &&
        target.txid === null &&
        target.retry_count === 0 &&
        target.created_at === fixture.created,
    );
    requireCheck(
      target.status === "broadcast_unknown" ||
        (target.status === "failed" &&
          before.audit?.resolution === "no_settlement_after_expiry"),
    );
    // Independently recheck account history through the live wallet RPC layer.
    const history = await rpc.call("z_listtransactions", [proof.accountUuid]);
    requireCheck(
      Array.isArray(history) &&
        history.length === 2 &&
        history.every((r) => r.account_uuid === proof.accountUuid),
    );
    const ids = new Set(history.map((r) => r.txid));
    requireCheck(
      ids.size === 2 && ids.has(fixture.payment) && ids.has(fixture.confirmed),
    );
    // This direct Ironwood payment cannot use the longer ZIP 318 migration expiry.
    // Revalidate the original paying memo and the exact receiving account.
    const original = await rpc.viewTransaction(fixture.payment);
    requireCheck(
      original.txid === fixture.payment && original.confirmations > 0,
    );
    let originalMatched = false;
    for (const note of original.outputs) {
      if (
        note.outgoing !== false ||
        note.pool !== "ironwood" ||
        note.valueZat !== 2000000 ||
        note.account_uuid !== proof.accountUuid
      )
        continue;
      const memo = decodePaymentMemo(note);
      if (memo.o === order && memo.r === route) originalMatched = true;
    }
    requireCheck(originalMatched);
    const confirmed = await rpc.viewTransaction(fixture.confirmed);
    requireCheck(
      confirmed.txid === fixture.confirmed && confirmed.confirmations > 0,
    );
    const receiver = await rpc.decodeUnifiedAddress(route);
    let matched = false;
    for (const note of confirmed.outputs) {
      if (
        note.outgoing !== true ||
        note.valueZat !== 1800000 ||
        note.pool !== "ironwood" ||
        typeof note.address !== "string"
      )
        continue;
      const destination = await rpc.decodeUnifiedAddress(note.address);
      if (
        typeof receiver.orchard === "string" &&
        receiver.orchard.length > 0 &&
        destination.orchard === receiver.orchard
      )
        matched = true;
    }
    requireCheck(matched);
    // A late sync/reorg change must fail before any write.
    validateProof(proof, await rpc.call("getwalletstatus"), Date.now());
    const evidence = {
      version: 1,
      source: "running-wallet-sqlite-and-live-account-rpc",
      walletVersion: proof.walletVersion,
      observedAt: new Date(proof.observedAt).toISOString(),
      nodeHeight: status.node_tip.height,
      fullySyncedHeight: status.fully_synced_height,
      matchingAccountTransactionCount: 2,
      otherMatchingAccountTransactions: 0,
      expiryAnchor: proof.expiryAnchor,
      standardExpiryUpperBound: proof.expiryAnchor.height + 41,
      reason:
        "No matching settlement or recorded send; standard send validity window has passed. Exact original RPC error is not recovered.",
    };
    let applied = false;
    if (apply && target.status !== "failed") {
      core.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE",
      );
      transaction = true;
      requireCheck(
        JSON.stringify(state(product, core)) === JSON.stringify(before),
      );
      core.exec(auditSchema);
      core
        .prepare(
          "INSERT INTO refund_resolutions(refund_id,payment_id,resolution,evidence_json,created_at) VALUES(?,?,'no_settlement_after_expiry',?,?)",
        )
        .run(
          fixture.refund,
          fixture.payment,
          JSON.stringify(evidence),
          new Date().toISOString(),
        );
      const changed = core
        .prepare(
          "UPDATE refund_events SET status='failed',updated_at=? WHERE id=? AND status='broadcast_unknown' AND txid IS NULL AND retry_count=0 AND amount_zat=200000 AND created_at=?",
        )
        .run(new Date().toISOString(), fixture.refund, fixture.created);
      requireCheck(changed.changes === 1);
      // Mirror only if this is the legacy row; the earlier real refund stays intact.
      core
        .prepare(
          "UPDATE refunds SET status='failed',updated_at=? WHERE id=? AND status='broadcast_unknown' AND txid IS NULL",
        )
        .run(new Date().toISOString(), fixture.refund);
      core.exec("COMMIT");
      transaction = false;
      applied = true;
    }
    return {
      read_only: !apply,
      eligible: true,
      applied,
      already_reconciled: target.status === "failed",
      status:
        applied || target.status === "failed" ? "failed" : "broadcast_unknown",
      confirmed_refund_zat: 1800000,
      reserved_refund_zat: applied || target.status === "failed" ? 0 : 200000,
      available_refund_zat: applied || target.status === "failed" ? 200000 : 0,
      routes_retained: true,
      sends_requested: 0,
      safe_to_retry_old_instruction: false,
      next_action: apply
        ? "No send was requested. Any new refund requires separate merchant authorization and sufficient funds plus fees."
        : "Dry run only. Use the explicit operator apply option to reconcile; no send is included.",
      evidence,
    };
  } finally {
    if (transaction) core.exec("ROLLBACK");
    core.close();
    product.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { ZalletRpcClient } = await import(
      "/app/.build/packages/zcash-adapter/src/index.js"
    );
    const { orchardRefundReceiver } = await import(
      "/app/.build/packages/zcash-adapter/src/refund-route.js"
    );
    const { refundReconciliationVersion } = await import(
      "/app/.build/packages/database/src/index.js"
    );
    const { decodeMemo } = await import(
      "/app/.build/packages/memo/src/index.js"
    );
    const raw = readFileSync(0, "utf8");
    requireCheck(raw.length < 64000);
    const result = await reconcileItem21({
      productPath: process.env.NOSTOS_PRODUCT_DATABASE_PATH,
      corePath: process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH,
      key: process.env.NOSTOS_PRODUCT_DATA_KEY,
      proof: JSON.parse(raw),
      apply: process.argv.includes("--apply"),
      capability: refundReconciliationVersion,
      verifyRoute: orchardRefundReceiver,
      decodePaymentMemo: decodeMemo,
      rpc: new ZalletRpcClient({
        url: process.env.NOSTOS_MERCHANT_WALLET_RPC_URL,
        cookieFile: process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE,
        timeoutMs: 5000,
      }),
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stdout.write(
      JSON.stringify({
        reconciliation_blocked: true,
        state_changed: process.argv.includes("--apply") ? null : false,
        inspect_before_repeating: true,
        sends_requested: 0,
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
