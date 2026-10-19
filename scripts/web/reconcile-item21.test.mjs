import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditSchema, fixture, reconcileItem21 } from "./reconcile-item21.mjs";

const directories = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "nostos-reconcile-"));
  directories.push(dir);
  const productPath = join(dir, "product.sqlite"),
    corePath = join(dir, "core.sqlite");
  const key = randomBytes(32).toString("hex"),
    route = "utest1" + "b".repeat(80);
  const account = "e8efee38-965f-4223-b656-a047e427a28f";
  function encrypted(value) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), body]
      .map((b) => b.toString("base64url"))
      .join(".");
  }
  const p = new DatabaseSync(productPath),
    c = new DatabaseSync(corePath);
  p.exec(
    "CREATE TABLE merchants(id TEXT PRIMARY KEY,wallet TEXT); CREATE TABLE checkouts(id TEXT,merchant_id TEXT,payment_txid TEXT,amount_zat INTEGER,route TEXT,order_ref TEXT)",
  );
  p.prepare("INSERT INTO merchants VALUES('merchant',?)").run(
    encrypted(account),
  );
  p.prepare("INSERT INTO checkouts VALUES(?,'merchant',?,2000000,?,?)").run(
    fixture.checkout,
    fixture.payment,
    encrypted(route),
    encrypted("fixture_order"),
  );
  c.exec(`CREATE TABLE payments(id TEXT PRIMARY KEY,merchant_id TEXT,payment_txid TEXT,amount_zat INTEGER,refund_address TEXT,status TEXT,order_reference TEXT);
    CREATE TABLE refund_events(id TEXT PRIMARY KEY,payment_id TEXT,amount_zat INTEGER,status TEXT,txid TEXT,retry_count INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE refunds AS SELECT * FROM refund_events`);
  c.prepare(
    "INSERT INTO payments VALUES(?,'merchant',?,2000000,?,'confirmed',?)",
  ).run(
    fixture.payment,
    fixture.payment,
    encrypted(route),
    encrypted("fixture_order"),
  );
  c.prepare(
    "INSERT INTO refund_events VALUES('first',?,1800000,'confirmed',?,0,'2026-10-04','2026-10-04')",
  ).run(fixture.payment, fixture.confirmed);
  c.prepare(
    "INSERT INTO refund_events VALUES(?,?,200000,'broadcast_unknown',NULL,0,?,?)",
  ).run(fixture.refund, fixture.payment, fixture.created, fixture.created);
  c.exec("INSERT INTO refunds SELECT * FROM refund_events WHERE id='first'");
  p.close();
  c.close();
  const proof = {
    walletVersion: "0.1.0-beta.3",
    observedAt: Date.now(),
    accountUuid: account,
    matchingAccount: {
      available: true,
      transaction_count: 2,
      other_transaction_count: 0,
      other_unmined_count: 0,
      invalid_txid_count: 0,
      known_transaction_matches: { payment: 1, confirmed_refund: 1 },
      nonchange_orchard_family_200000_zat_send_transaction_count: 0,
    },
    expiryAnchor: { height: 4475492, time: 1791819667 },
    latestStoredBlock: 4484533,
  };
  const status = {
    node_tip: { height: 4484533, blockhash: "c".repeat(64) },
    wallet_tip: { height: 4484533, blockhash: "c".repeat(64) },
    fully_synced_height: 4484533,
    locked: false,
  };
  const calls = [];
  const rpc = {
    call: async (method) => {
      calls.push(method);
      if (method === "getwalletstatus") return status;
      if (method === "z_listtransactions")
        return [fixture.payment, fixture.confirmed].map((txid) => ({
          txid,
          account_uuid: account,
        }));
      throw new Error("unexpected RPC");
    },
    viewTransaction: async (id) =>
      id === fixture.payment
        ? {
            txid: fixture.payment,
            confirmations: 100,
            outputs: [
              {
                outgoing: false,
                valueZat: 2000000,
                pool: "ironwood",
                account_uuid: account,
              },
            ],
          }
        : {
            txid: fixture.confirmed,
            confirmations: 100,
            outputs: [
              {
                outgoing: true,
                valueZat: 1800000,
                pool: "ironwood",
                address: route,
              },
            ],
          },
    decodeUnifiedAddress: async () => ({ orchard: route }),
  };
  return {
    productPath,
    corePath,
    key,
    route,
    account,
    proof,
    status,
    rpc,
    calls,
    capability: 1,
    decodePaymentMemo: () => ({ o: "fixture_order", r: route }),
    verifyRoute: async (r) => {
      expect(r).toBe(route);
    },
  };
}
function rows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      events: db.prepare("SELECT * FROM refund_events ORDER BY id").all(),
      mirror: db.prepare("SELECT * FROM refunds").all(),
      payment: db.prepare("SELECT * FROM payments").get(),
      auditCount: db
        .prepare("SELECT COUNT(*) AS n FROM refund_resolutions")
        .get().n,
    };
  } finally {
    db.close();
  }
}

describe("operator reconciliation without sending", () => {
  it.each(["wrong-memo", "other-pool"])(
    "blocks %s before any write",
    async (kind) => {
      const s = setup(),
        before = readFileSync(s.corePath);
      if (kind === "wrong-memo")
        s.decodePaymentMemo = () => ({ o: "wrong", r: s.route });
      if (kind === "other-pool") {
        const read = s.rpc.viewTransaction;
        s.rpc.viewTransaction = async (id) => {
          const tx = await read(id);
          if (id === fixture.payment) tx.outputs[0].pool = "orchard";
          return tx;
        };
      }
      await expect(reconcileItem21({ ...s, apply: true })).rejects.toThrow();
      expect(readFileSync(s.corePath)).toEqual(before);
    },
  );

  it("dry-runs without changing either database or disclosing private data", async () => {
    const s = setup(),
      before = [readFileSync(s.productPath), readFileSync(s.corePath)];
    const result = await reconcileItem21(s);
    expect(result).toMatchObject({
      eligible: true,
      applied: false,
      reserved_refund_zat: 200000,
      sends_requested: 0,
    });
    expect([readFileSync(s.productPath), readFileSync(s.corePath)]).toEqual(
      before,
    );
    for (const value of [s.route, s.key, s.account])
      expect(JSON.stringify(result)).not.toContain(value);
    expect(
      s.calls.every((c) =>
        ["getwalletstatus", "z_listtransactions"].includes(c),
      ),
    ).toBe(true);
  });
  it("applies once, keeps prior settlement/routes and preserves the failed instruction and audit", async () => {
    const s = setup(),
      product = readFileSync(s.productPath);
    const before = new DatabaseSync(s.corePath, { readOnly: true });
    const cipher = before
      .prepare("SELECT refund_address FROM payments")
      .get().refund_address;
    before.close();
    const result = await reconcileItem21({ ...s, apply: true });
    expect(result).toMatchObject({
      applied: true,
      status: "failed",
      available_refund_zat: 200000,
      reserved_refund_zat: 0,
      confirmed_refund_zat: 1800000,
      routes_retained: true,
      safe_to_retry_old_instruction: false,
    });
    const saved = rows(s.corePath);
    expect(saved.events.find((r) => r.id === fixture.refund)).toMatchObject({
      status: "failed",
      txid: null,
      amount_zat: 200000,
      retry_count: 0,
    });
    expect(saved.mirror[0]).toMatchObject({
      id: "first",
      status: "confirmed",
      txid: fixture.confirmed,
      amount_zat: 1800000,
    });
    expect(saved.payment.refund_address).toBe(cipher);
    expect(saved.auditCount).toBe(1);
    expect(readFileSync(s.productPath)).toEqual(product);
    expect(await reconcileItem21({ ...s, apply: true })).toMatchObject({
      applied: false,
      already_reconciled: true,
    });
    expect(rows(s.corePath).auditCount).toBe(1);
  });
  it.each([
    "stale",
    "locked",
    "different-chain",
    "unscanned",
    "extra-record",
    "unexpired",
    "wrong-account",
    "old-app",
  ])("rejects %s evidence without any write", async (kind) => {
    const s = setup(),
      before = readFileSync(s.corePath);
    if (kind === "stale") s.proof.observedAt -= 70000;
    if (kind === "locked") s.status.locked = true;
    if (kind === "different-chain")
      s.status.wallet_tip.blockhash = "d".repeat(64);
    if (kind === "unscanned") s.status.fully_synced_height--;
    if (kind === "extra-record")
      s.proof.matchingAccount.other_transaction_count = 1;
    if (kind === "unexpired")
      s.proof.expiryAnchor.height = s.status.node_tip.height - 30;
    if (kind === "wrong-account") s.proof.accountUuid = "d".repeat(36);
    if (kind === "old-app") s.capability = 0;
    await expect(reconcileItem21({ ...s, apply: true })).rejects.toThrow();
    expect(readFileSync(s.corePath)).toEqual(before);
  });
  it("refuses changed ledger state after wallet verification", async () => {
    const s = setup();
    let calls = 0;
    const original = s.rpc.call;
    s.rpc.call = async (method) => {
      if (method === "getwalletstatus" && ++calls === 2) {
        const c = new DatabaseSync(s.corePath);
        c.prepare(
          "UPDATE refund_events SET updated_at='changed' WHERE id=?",
        ).run(fixture.refund);
        c.close();
      }
      return original(method);
    };
    await expect(reconcileItem21({ ...s, apply: true })).rejects.toThrow();
    const c = new DatabaseSync(s.corePath, { readOnly: true });
    expect(
      c
        .prepare("SELECT status FROM refund_events WHERE id=?")
        .get(fixture.refund).status,
    ).toBe("broadcast_unknown");
    c.close();
  });
  it("rolls back audit and status together if the final update fails", async () => {
    const s = setup(),
      c = new DatabaseSync(s.corePath);
    c.exec(auditSchema);
    c.exec(
      "CREATE TRIGGER refuse_update BEFORE UPDATE ON refund_events BEGIN SELECT RAISE(ABORT,'fixture refusal'); END",
    );
    c.close();
    await expect(reconcileItem21({ ...s, apply: true })).rejects.toThrow();
    const saved = rows(s.corePath);
    expect(saved.auditCount).toBe(0);
    expect(saved.events.find((r) => r.id === fixture.refund).status).toBe(
      "broadcast_unknown",
    );
  });
});
