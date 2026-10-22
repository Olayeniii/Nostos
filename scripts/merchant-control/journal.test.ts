import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ControlJournal } from "./journal.js";

// Invented bookkeeping fixtures. No keys, valid transactions or funded evidence.
const plan = {
  id: "control_one",
  merchantId: "merchant_one",
  approvalId: "approval_one",
  approvedAt: "2026-10-22T12:00:00.000Z",
  chain: "mainnet",
  pool: "ironwood",
  accountBinding: "1".repeat(64),
  receiverBinding: "2".repeat(64),
  memoBinding: "3".repeat(64),
  amountZat: 10_000,
  maxFeeZat: 10_000,
  maxDebitZat: 20_000,
  minConfirmations: 3,
};
const observation = {
  chain: plan.chain,
  pool: plan.pool,
  accountBinding: plan.accountBinding,
  receiverBinding: plan.receiverBinding,
  memoBinding: plan.memoBinding,
  amountZat: plan.amountZat,
  feeZat: 10_000,
  txid: "4".repeat(64),
  outputIndex: 1,
  blockHeight: 3_524_931,
  blockHash: "5".repeat(64),
  confirmations: 3,
};
const directories: string[] = [];
const connections: DatabaseSync[] = [];
function open(path = ":memory:") {
  const db = new DatabaseSync(path);
  connections.push(db);
  return { db, journal: new ControlJournal(db) };
}
function path() {
  const root = mkdtempSync(join(tmpdir(), "nostos-control-test-"));
  directories.push(root);
  return join(root, "control.sqlite");
}
function close(db: DatabaseSync) {
  db.close();
  connections.splice(connections.indexOf(db), 1);
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true });
});

describe("isolated control-transfer bookkeeping", () => {
  it("saves an immutable, idempotent approved instruction across reopen", () => {
    const file = path();
    const first = open(file);
    expect(first.journal.recordApprovedPlan(plan)).toEqual({ created: true });
    close(first.db);
    const second = open(file);
    expect(second.journal.recordApprovedPlan({ ...plan })).toEqual({
      created: false,
    });
    for (const changed of [
      { amountZat: 10_001 },
      { receiverBinding: "6".repeat(64) },
      { approvalId: "new_approval" },
      { approvedAt: "2026-10-22T13:00:00.000Z" },
    ])
      expect(() =>
        second.journal.recordApprovedPlan({ ...plan, ...changed }),
      ).toThrow("refused");
    expect(second.journal.receipt(plan.id).state).toBe("pending");
    expect(() =>
      second.db.prepare("UPDATE control_plans SET plan='changed'").run(),
    ).toThrow();
    expect(() => second.db.exec("DELETE FROM control_plans")).toThrow();
  });

  it("allows only one send reservation across independent connections and a crash", () => {
    const file = path();
    const first = open(file);
    const second = open(file);
    first.journal.recordApprovedPlan(plan);
    first.journal.reserveExternalSend(plan.id);
    expect(() => second.journal.reserveExternalSend(plan.id)).toThrow(
      "refused",
    );
    close(first.db);
    close(second.db);
    const reopened = open(file);
    expect(reopened.journal.receipt(plan.id).state).toBe("broadcasting");
    reopened.journal.markBroadcastUnknown(plan.id);
    expect(() => reopened.journal.reserveExternalSend(plan.id)).toThrow(
      "refused",
    );
    expect(reopened.journal.receipt(plan.id).state).toBe("broadcast_unknown");
    expect(() =>
      reopened.journal.recordApprovedPlan({ ...plan, id: "replacement" }),
    ).toThrow("refused");
    expect(() =>
      reopened.journal.recordApprovedPlan({
        ...plan,
        id: "replacement",
        merchantId: "other",
        approvalId: "other",
      }),
    ).toThrow("refused");
  });

  it("keeps a known txid immutable and refuses a second broadcast attempt", () => {
    const { journal } = open();
    journal.recordApprovedPlan(plan);
    expect(() => journal.recordTxid(plan.id, observation.txid)).toThrow(
      "refused",
    );
    expect(() => journal.markBroadcastUnknown(plan.id)).toThrow("refused");
    journal.reserveExternalSend(plan.id);
    journal.markBroadcastUnknown(plan.id);
    journal.recordTxid(plan.id, observation.txid);
    journal.recordTxid(plan.id, observation.txid);
    journal.markBroadcastUnknown(plan.id);
    expect(journal.receipt(plan.id).state).toBe("broadcast");
    expect(() => journal.recordTxid(plan.id, "6".repeat(64))).toThrow(
      "refused",
    );
    expect(() => journal.reserveExternalSend(plan.id)).toThrow("refused");
  });

  it("records a duplicate candidate once across reopen without claiming live proof", () => {
    const file = path();
    const first = open(file);
    first.journal.recordApprovedPlan(plan);
    first.journal.reserveExternalSend(plan.id);
    first.journal.markBroadcastUnknown(plan.id);
    expect(first.journal.recordCandidate(plan.id, observation)).toEqual({
      created: true,
    });
    close(first.db);
    const second = open(file);
    expect(second.journal.recordCandidate(plan.id, observation)).toEqual({
      created: false,
    });
    expect(
      second.db.prepare("SELECT COUNT(*) AS n FROM control_observations").get()
        ?.n,
    ).toBe(1);
    expect(second.journal.receipt(plan.id)).toEqual({
      state: "broadcast",
      candidateRecorded: true,
      confirmed: false,
      liveEvidenceVerified: false,
      compatibilityGatePassed: false,
    });
    expect(() =>
      second.db.exec("UPDATE control_plans SET state='confirmed'"),
    ).toThrow();
    expect(JSON.stringify(second.journal.receipt(plan.id))).not.toContain(
      observation.txid,
    );
    expect(() => second.journal.reserveExternalSend(plan.id)).toThrow(
      "refused",
    );
  });

  it("rejects chain, pool, account, recipient, amount and memo mismatches atomically", () => {
    const { db, journal } = open();
    journal.recordApprovedPlan(plan);
    expect(() => journal.recordCandidate(plan.id, observation)).toThrow(
      "refused",
    );
    journal.reserveExternalSend(plan.id);
    journal.markBroadcastUnknown(plan.id);
    for (const changed of [
      { chain: "testnet" },
      { pool: "orchard" },
      { pool: "transparent" },
      { accountBinding: "6".repeat(64) },
      { receiverBinding: "6".repeat(64) },
      { memoBinding: "6".repeat(64) },
      { amountZat: 9_999 },
      { confirmations: 2 },
      { feeZat: 10_001 },
      { blockHeight: 0 },
      { outputIndex: -1 },
      { txid: "not_a_txid" },
      { blockHash: "not_a_block" },
    ]) {
      expect(() =>
        journal.recordCandidate(plan.id, { ...observation, ...changed }),
      ).toThrow("refused");
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM control_observations").get()?.n,
      ).toBe(0);
      expect(journal.receipt(plan.id).state).toBe("broadcast_unknown");
    }
  });

  it("enforces the exact approval fee, debit and confirmation limits", () => {
    const { journal } = open();
    const tighter = {
      ...plan,
      maxFeeZat: 5_000,
      maxDebitZat: 15_000,
      minConfirmations: 4,
    };
    journal.recordApprovedPlan(tighter);
    journal.reserveExternalSend(plan.id);
    expect(() =>
      journal.recordCandidate(plan.id, { ...observation, confirmations: 4 }),
    ).toThrow("refused");
    expect(() =>
      journal.recordCandidate(plan.id, { ...observation, feeZat: 5_000 }),
    ).toThrow("refused");
    expect(
      journal.recordCandidate(plan.id, {
        ...observation,
        feeZat: 5_000,
        confirmations: 4,
      }),
    ).toEqual({ created: true });
  });

  it("holds conflicting transaction or block evidence without clearing the reservation", () => {
    const { db, journal } = open();
    journal.recordApprovedPlan(plan);
    journal.reserveExternalSend(plan.id);
    journal.recordTxid(plan.id, observation.txid);
    expect(() =>
      journal.recordCandidate(plan.id, {
        ...observation,
        txid: "6".repeat(64),
      }),
    ).toThrow("refused");
    journal.recordCandidate(plan.id, observation);
    expect(() =>
      journal.recordCandidate(plan.id, {
        ...observation,
        blockHash: "6".repeat(64),
      }),
    ).toThrow("refused");
    expect(() => db.exec("DELETE FROM control_observations")).toThrow();
    expect(() => journal.reserveExternalSend(plan.id)).toThrow("refused");
    expect(journal.receipt(plan.id).confirmed).toBe(false);
  });

  it("rejects unsafe budgets, unknown fields and invalid approvals before saving", () => {
    const { db, journal } = open();
    for (const changed of [
      { chain: "testnet" },
      { pool: "sapling" },
      { maxFeeZat: 10_001 },
      { maxDebitZat: 20_001 },
      { maxDebitZat: 15_000 },
      { minConfirmations: 2 },
      { amountZat: 10_000.5 },
      { approvedAt: "2026-02-30T12:00:00.000Z" },
      { approvedAt: "unapproved" },
      { memo: "invented_private_memo" },
      { receiverBinding: "tex1_invalid" },
    ])
      expect(() => journal.recordApprovedPlan({ ...plan, ...changed })).toThrow(
        "refused",
      );
    expect(db.prepare("SELECT COUNT(*) AS n FROM control_plans").get()?.n).toBe(
      0,
    );
  });

  it("keeps private payloads out of errors, receipts and on-disk bookkeeping", () => {
    const file = path();
    const { db, journal } = open(file);
    const privateText = "invented_private_payload_do_not_store";
    journal.recordApprovedPlan(plan);
    journal.reserveExternalSend(plan.id);
    for (const input of [
      { ...observation, memo: privateText },
      { ...observation, receiverBinding: privateText },
      { ...observation, fullViewingKey: privateText },
    ]) {
      try {
        journal.recordCandidate(plan.id, input);
        throw new Error("expected refusal");
      } catch (error) {
        expect((error as Error).message).toBe(
          "Control journal operation refused.",
        );
      }
    }
    expect(JSON.stringify(journal.receipt(plan.id))).not.toContain(privateText);
    close(db);
    for (const root of directories)
      for (const name of readdirSync(root)) {
        expect(
          readFileSync(join(root, name)).includes(Buffer.from(privateText)),
        ).toBe(false);
      }
  });

  it("refuses an existing product or wallet database before creating tables", () => {
    const db = new DatabaseSync(":memory:");
    connections.push(db);
    db.exec(
      "CREATE TABLE payments(id TEXT); INSERT INTO payments VALUES('preserved')",
    );
    expect(() => new ControlJournal(db)).toThrow("refused");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    ).toEqual(["payments"]);
    expect(db.prepare("SELECT id FROM payments").get()?.id).toBe("preserved");
  });

  it("refuses partial or differently bound control databases without adoption", () => {
    const db = new DatabaseSync(":memory:");
    connections.push(db);
    db.exec(
      "CREATE TABLE control_environment(id INTEGER,profile TEXT); INSERT INTO control_environment VALUES(1,'testnet')",
    );
    expect(() => new ControlJournal(db)).toThrow("refused");
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'")
        .get()?.n,
    ).toBe(1);
    expect(
      db.prepare("SELECT profile FROM control_environment").get()?.profile,
    ).toBe("testnet");
  });
});
