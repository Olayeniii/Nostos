import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { inspectAttempt } from "./inspect-mainnet-refund-attempt.mjs";
const key = "b".repeat(64),
  txid = "a".repeat(64),
  memo = "nostos:refund:f1be282d-30b6-43e7-8c28-e7d7df9d62f7";
function setup(callback) {
  const root = mkdtempSync(join(tmpdir(), "refund-attempt-"));
  const productPath = join(root, "p.sqlite"),
    corePath = join(root, "c.sqlite");
  const p = new DatabaseSync(productPath),
    c = new DatabaseSync(corePath);
  p.exec(
    "CREATE TABLE refund_requests(id TEXT,checkout_id TEXT,status TEXT,approved_zat INTEGER,created_at TEXT,decided_at TEXT); CREATE TABLE checkouts(id TEXT,merchant_id TEXT,payment_txid TEXT,amount_zat INTEGER,paid_at TEXT); INSERT INTO refund_requests VALUES('request','checkout','approved',50000,'created','decided'); INSERT INTO checkouts VALUES('checkout','merchant','payment',100000,'paid');",
  );
  c.exec(
    "CREATE TABLE observer_record_instructions(id TEXT,kind TEXT,memo TEXT,request_id TEXT,checkout_id TEXT,refund_id TEXT,merchant_id TEXT,state TEXT,handoff_started INTEGER,txid TEXT,fee_cap INTEGER); CREATE TABLE refund_events(id TEXT,payment_id TEXT,status TEXT,amount_zat INTEGER,created_at TEXT,updated_at TEXT); CREATE TABLE payments(id TEXT,payment_txid TEXT,merchant_id TEXT,amount_zat INTEGER,status TEXT); INSERT INTO refund_events VALUES('refund','payment','broadcasting',50000,'created','updated'); INSERT INTO payments VALUES('payment','payment','merchant',100000,'confirmed');",
  );
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  const body = Buffer.concat([cipher.update(memo), cipher.final()]);
  const encoded = [nonce, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64url"))
    .join(".");
  c.prepare(
    "INSERT INTO observer_record_instructions VALUES('plan','refund',?,'request','checkout','refund','merchant','pending',1,NULL,10000)",
  ).run(encoded);
  p.close();
  c.close();
  try {
    callback({ productPath, corePath, key, txid, memo });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("correlates exactly while preserving ledger bytes and private fields", () =>
  setup((args) => {
    const hash = (p) =>
      createHash("sha256").update(readFileSync(p)).digest("hex");
    const before = [hash(args.productPath), hash(args.corePath)];
    const r = inspectAttempt(args);
    assert.equal(r.matching_instructions, 1);
    assert.equal(r.saved_fields_consistent, true);
    assert.equal(r.reserved_amount_zat, 50000);
    assert.equal(r.transaction_bound, false);
    assert.equal(r.retry_authorized, false);
    assert.ok(!JSON.stringify(r).includes(memo));
    assert.ok(!JSON.stringify(r).includes(key));
    assert.deepEqual([hash(args.productPath), hash(args.corePath)], before);
  }));
test("mismatched memo does not select another refund", () =>
  setup((args) => {
    const r = inspectAttempt({
      ...args,
      memo: "nostos:refund:11111111-1111-4111-8111-111111111111",
    });
    assert.equal(r.matching_instructions, 0);
    assert.equal(r.retry_authorized, false);
  }));
test("mismatched amount is reported without recovery or mutation", () =>
  setup((args) => {
    const db = new DatabaseSync(args.corePath);
    db.exec("UPDATE refund_events SET amount_zat=60000");
    db.close();
    const r = inspectAttempt(args);
    assert.equal(r.saved_fields_consistent, false);
    assert.equal(r.retry_authorized, false);
  }));
