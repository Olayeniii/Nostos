import type { DatabaseSync } from "node:sqlite";
import type { RefundStatus } from "../../packages/core/src/index.js";
import {
  consumeVerifiedControl,
  isVerifiedControl,
  type VerifiedControl,
} from "./verification.js";

// Private control journal. No product settlement or signing API. Opaque request
// commitments alone are never accepted as verified transaction evidence.
interface Plan {
  id: string;
  merchantId: string;
  approvalId: string;
  approvedAt: string;
  chain: "mainnet";
  pool: "orchard" | "ironwood";
  accountBinding: string;
  receiverBinding: string;
  memoBinding: string;
  amountZat: number;
  maxFeeZat: number;
  maxDebitZat: number;
  minConfirmations: number;
}

interface Observation {
  chain: "mainnet";
  pool: "orchard" | "ironwood";
  accountBinding: string;
  receiverBinding: string;
  memoBinding: string;
  amountZat: number;
  feeZat: number;
  txid: string;
  outputIndex: number;
  blockHeight: number;
  blockHash: string;
  confirmations: number;
}

type State = Extract<
  RefundStatus,
  "pending" | "broadcasting" | "broadcast_unknown" | "broadcast"
>;
interface Row {
  plan: string;
  state: State;
  txid: string | null;
}

function refuse(): never {
  // Never interpolate caller data, SQL errors, transaction references or hashes.
  throw new Error("Control journal operation refused.");
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== [...keys].sort().join()) refuse();
  return record;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(value))
    refuse();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) refuse();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    refuse();
  return value;
}

function context(p: Record<string, unknown>) {
  if (p.chain !== "mainnet" || (p.pool !== "orchard" && p.pool !== "ironwood"))
    refuse();
  return {
    chain: p.chain,
    pool: p.pool,
    accountBinding: digest(p.accountBinding),
    receiverBinding: digest(p.receiverBinding),
    memoBinding: digest(p.memoBinding),
    amountZat: integer(p.amountZat, 10_000, 10_000),
  } as const;
}

function parsePlan(value: unknown): Plan {
  const p = exact(value, [
    "id",
    "merchantId",
    "approvalId",
    "approvedAt",
    "chain",
    "pool",
    "accountBinding",
    "receiverBinding",
    "memoBinding",
    "amountZat",
    "maxFeeZat",
    "maxDebitZat",
    "minConfirmations",
  ]);
  if (
    typeof p.approvedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.approvedAt) ||
    !Number.isFinite(Date.parse(p.approvedAt)) ||
    new Date(p.approvedAt).toISOString() !== p.approvedAt
  )
    refuse();
  const plan = {
    id: identifier(p.id),
    merchantId: identifier(p.merchantId),
    approvalId: identifier(p.approvalId),
    approvedAt: p.approvedAt,
    ...context(p),
    maxFeeZat: integer(p.maxFeeZat, 1, 10_000),
    maxDebitZat: integer(p.maxDebitZat, 10_001, 20_000),
    minConfirmations: integer(p.minConfirmations, 3, 100),
  };
  if (plan.amountZat + plan.maxFeeZat > plan.maxDebitZat) refuse();
  return plan;
}

function parseObservation(value: unknown): Observation {
  const p = exact(value, [
    "chain",
    "pool",
    "accountBinding",
    "receiverBinding",
    "memoBinding",
    "amountZat",
    "feeZat",
    "txid",
    "outputIndex",
    "blockHeight",
    "blockHash",
    "confirmations",
  ]);
  return {
    ...context(p),
    feeZat: integer(p.feeZat, 0, 10_000),
    txid: digest(p.txid),
    outputIndex: integer(p.outputIndex, 0, 0xffff_ffff),
    blockHeight: integer(p.blockHeight, 1, 0xffff_ffff),
    blockHash: digest(p.blockHash),
    confirmations: integer(p.confirmations, 3, 0xffff_ffff),
  };
}

export class ControlJournal {
  constructor(private readonly database: DatabaseSync) {
    this.safe(() => {
      // Inject a dedicated private database. Never adopt an application/wallet DB.
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      if (
        tables.some(
          (t) =>
            ![
              "control_environment",
              "control_plans",
              "control_observations",
              "control_checks",
            ].includes(String(t.name)),
        )
      )
        refuse();
      if (
        tables.length !== 0 &&
        (![3, 4].includes(tables.length) ||
          (tables.length === 3 &&
            tables.some((t) => t.name === "control_checks")) ||
          database
            .prepare("SELECT profile FROM control_environment WHERE id=1")
            .get()?.profile !== "nostos-control-mainnet-v1")
      )
        refuse();
      database.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
      this.atomic(() => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS control_environment (
            id INTEGER PRIMARY KEY CHECK(id=1),
            profile TEXT NOT NULL CHECK(profile='nostos-control-mainnet-v1')
          );
          INSERT OR IGNORE INTO control_environment VALUES(1,'nostos-control-mainnet-v1');
          CREATE TABLE IF NOT EXISTS control_plans (
            id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL UNIQUE,
            account_binding TEXT NOT NULL UNIQUE, approval_id TEXT NOT NULL UNIQUE,
            plan TEXT NOT NULL, state TEXT NOT NULL
              CHECK(state IN ('pending','broadcasting','broadcast_unknown','broadcast')),
            txid TEXT UNIQUE
          );
          CREATE TABLE IF NOT EXISTS control_observations (
            plan_id TEXT PRIMARY KEY REFERENCES control_plans(id),
            chain TEXT NOT NULL CHECK(chain='mainnet'), txid TEXT NOT NULL,
            pool TEXT NOT NULL CHECK(pool IN ('orchard','ironwood')),
            output_index INTEGER NOT NULL, observation TEXT NOT NULL,
            UNIQUE(chain,txid,pool,output_index)
          );
          CREATE TABLE IF NOT EXISTS control_checks (
            plan_id TEXT PRIMARY KEY REFERENCES control_plans(id),
            valid INTEGER NOT NULL CHECK(valid IN (0,1)), evidence TEXT NOT NULL
          );
          CREATE TRIGGER IF NOT EXISTS control_plan_immutable
            BEFORE UPDATE OF id,merchant_id,account_binding,approval_id,plan ON control_plans
            BEGIN SELECT RAISE(ABORT,'immutable_control_plan'); END;
          CREATE TRIGGER IF NOT EXISTS control_plan_retained BEFORE DELETE ON control_plans
            BEGIN SELECT RAISE(ABORT,'retained_control_plan'); END;
          CREATE TRIGGER IF NOT EXISTS control_observation_immutable BEFORE UPDATE ON control_observations
            BEGIN SELECT RAISE(ABORT,'immutable_control_observation'); END;
          CREATE TRIGGER IF NOT EXISTS control_observation_retained BEFORE DELETE ON control_observations
            BEGIN SELECT RAISE(ABORT,'retained_control_observation'); END;
        `);
        if (
          database
            .prepare("SELECT profile FROM control_environment WHERE id=1")
            .get()?.profile !== "nostos-control-mainnet-v1"
        )
          refuse();
      });
    });
  }

  private safe<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      return refuse();
    }
  }

  private atomic<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.database.exec("COMMIT");
      return value;
    } catch {
      this.database.exec("ROLLBACK");
      return refuse();
    }
  }

  private row(id: string): Row {
    const row = this.database
      .prepare("SELECT plan,state,txid FROM control_plans WHERE id=?")
      .get(identifier(id)) as unknown as Row | undefined;
    if (!row) refuse();
    return row;
  }

  // Caller approval is a recorded assertion, not cryptographic approval proof.
  // Only the separate approved operator handoff invokes this; never a web route.
  recordApprovedPlan(input: unknown): { created: boolean } {
    return this.safe(() => {
      const plan = parsePlan(input);
      const encoded = JSON.stringify(plan);
      return this.atomic(() => {
        const old = this.database
          .prepare("SELECT plan FROM control_plans WHERE id=?")
          .get(plan.id);
        if (old) {
          if (old.plan !== encoded) refuse();
          return { created: false };
        }
        this.database
          .prepare("INSERT INTO control_plans VALUES(?,?,?,?,?,'pending',NULL)")
          .run(
            plan.id,
            plan.merchantId,
            plan.accountBinding,
            plan.approvalId,
            encoded,
          );
        return { created: true };
      });
    });
  }

  // Durable boundary BEFORE handoff. A crash from here is an uncertain send.
  // It can never return to pending; no replacement/retry-send method exists.
  reserveExternalSend(id: string): void {
    this.safe(() =>
      this.atomic(() => {
        const changed = this.database
          .prepare(
            "UPDATE control_plans SET state='broadcasting' WHERE id=? AND state='pending'",
          )
          .run(identifier(id));
        if (changed.changes !== 1) refuse();
      }),
    );
  }

  markBroadcastUnknown(id: string): void {
    this.safe(() =>
      this.atomic(() => {
        const row = this.row(id);
        if (row.state === "pending") refuse();
        if (row.txid === null)
          this.database
            .prepare(
              "UPDATE control_plans SET state='broadcast_unknown' WHERE id=?",
            )
            .run(id);
      }),
    );
  }

  recordTxid(id: string, txid: string): void {
    this.safe(() =>
      this.atomic(() => {
        const row = this.row(id);
        digest(txid);
        if (row.state === "pending" || (row.txid !== null && row.txid !== txid))
          refuse();
        this.database
          .prepare(
            "UPDATE control_plans SET state='broadcast',txid=? WHERE id=?",
          )
          .run(txid, id);
      }),
    );
  }

  // Candidate bookkeeping ONLY. Caller-supplied chain/decryption claims cannot
  // confirm a send or close the compatibility gate.
  recordCandidate(id: string, input: unknown): { created: boolean } {
    return this.safe(() => {
      const observed = parseObservation(input);
      return this.atomic(() => {
        const row = this.row(id);
        const plan = parsePlan(JSON.parse(row.plan));
        if (
          row.state === "pending" ||
          (row.txid !== null && row.txid !== observed.txid)
        )
          refuse();
        for (const field of [
          "chain",
          "pool",
          "accountBinding",
          "receiverBinding",
          "memoBinding",
          "amountZat",
        ] as const) {
          if (plan[field] !== observed[field]) refuse();
        }
        if (
          observed.confirmations < plan.minConfirmations ||
          observed.feeZat > plan.maxFeeZat ||
          observed.amountZat + observed.feeZat > plan.maxDebitZat
        )
          refuse();
        const encoded = JSON.stringify(observed);
        const old = this.database
          .prepare(
            "SELECT observation FROM control_observations WHERE plan_id=?",
          )
          .get(id);
        if (old) {
          if (old.observation !== encoded) refuse();
          return { created: false };
        }
        this.database
          .prepare("INSERT INTO control_observations VALUES(?,?,?,?,?,?)")
          .run(
            id,
            observed.chain,
            observed.txid,
            observed.pool,
            observed.outputIndex,
            encoded,
          );
        this.database
          .prepare(
            "UPDATE control_plans SET state='broadcast',txid=? WHERE id=?",
          )
          .run(observed.txid, id);
        return { created: true };
      });
    });
  }

  receipt(id: string) {
    return this.safe(() => {
      const row = this.row(id);
      const observed = this.database
        .prepare("SELECT 1 FROM control_observations WHERE plan_id=?")
        .get(id);
      const checked =
        this.database
          .prepare("SELECT valid FROM control_checks WHERE plan_id=?")
          .get(id)?.valid === 1;
      return {
        state: row.state,
        candidateRecorded: !!observed,
        confirmed: checked,
        liveEvidenceVerified: checked,
        compatibilityGatePassed: checked,
      };
    });
  }

  beginRecheck(id: string): void {
    this.safe(() =>
      this.atomic(() => {
        this.row(id);
        this.database
          .prepare("UPDATE control_checks SET valid=0 WHERE plan_id=?")
          .run(id);
      }),
    );
  }

  recordRechecked(
    id: string,
    first: VerifiedControl,
    second: VerifiedControl,
  ): void {
    this.beginRecheck(id);
    this.safe(() =>
      this.atomic(() => {
        if (
          !isVerifiedControl(first) ||
          !isVerifiedControl(second) ||
          first.nonce === second.nonce
        )
          refuse();
        if (!consumeVerifiedControl(first) || !consumeVerifiedControl(second))
          refuse();
        const row = this.row(id);
        const plan = parsePlan(JSON.parse(row.plan));
        const a = parseObservation(first.observation);
        const b = parseObservation(second.observation);
        const immutable = (o: Observation) =>
          JSON.stringify({ ...o, confirmations: 0 });
        if (
          immutable(a) !== immutable(b) ||
          second.tipHeight < first.tipHeight ||
          (second.tipHeight === first.tipHeight &&
            second.tipHash !== first.tipHash) ||
          b.confirmations < a.confirmations ||
          first.grossInputZat !== second.grossInputZat ||
          second.grossInputZat > plan.maxDebitZat ||
          row.state === "pending" ||
          row.txid !== b.txid
        )
          refuse();
        for (const field of [
          "chain",
          "pool",
          "accountBinding",
          "receiverBinding",
          "memoBinding",
          "amountZat",
        ] as const) {
          if (plan[field] !== b[field]) refuse();
        }
        if (
          b.feeZat > plan.maxFeeZat ||
          b.confirmations < plan.minConfirmations ||
          b.amountZat + b.feeZat > plan.maxDebitZat
        )
          refuse();
        const old = this.database
          .prepare(
            "SELECT observation FROM control_observations WHERE plan_id=?",
          )
          .get(id);
        if (
          old &&
          immutable(parseObservation(JSON.parse(String(old.observation)))) !==
            immutable(b)
        )
          refuse();
        if (!old)
          this.database
            .prepare("INSERT INTO control_observations VALUES(?,?,?,?,?,?)")
            .run(id, b.chain, b.txid, b.pool, b.outputIndex, JSON.stringify(b));
        this.database
          .prepare(
            "INSERT INTO control_checks VALUES(?,1,?) ON CONFLICT(plan_id) DO UPDATE SET valid=1,evidence=excluded.evidence",
          )
          .run(
            id,
            JSON.stringify({
              observation: b,
              tipHeight: second.tipHeight,
              tipHash: second.tipHash,
              grossInputZat: second.grossInputZat,
              firstNonce: first.nonce,
              secondNonce: second.nonce,
            }),
          );
      }),
    );
  }
}
