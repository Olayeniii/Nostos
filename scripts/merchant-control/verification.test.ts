import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  cpSync,
  mkdirSync,
  linkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ControlJournal } from "./journal.js";
import { verifyWithHelper, type VerifiedControl } from "./verification.js";

// Simulated trusted-helper tests only. No valid addresses, keys or mined txs.
const roots: string[] = [];
const connections: DatabaseSync[] = [];
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
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nostos-private-control-test-"));
  roots.push(root);
  const binary = join(root, "nostos-control-check");
  const source = `#!${process.execPath}
const fs=require('node:fs'),crypto=require('node:crypto');
const envelope=JSON.parse(fs.readFileSync(0,'utf8')),body=JSON.parse(envelope.body);
let options={};try{options=JSON.parse(fs.readFileSync(__filename+'.options','utf8'))}catch{}
let n=0;try{n=Number(fs.readFileSync(__filename+'.count','utf8'))}catch{}
fs.writeFileSync(__filename+'.count',String(++n));
const bindings={accountBinding:'1'.repeat(64),receiverBinding:'2'.repeat(64),memoBinding:'3'.repeat(64)};
let result=body.mode==='prepare'?{...bindings,receiver:'u1'+'q'.repeat(80),reference:body.reference,birthday:body.birthday}:
body.mode==='preflight'?{...bindings,fundingReady:!options.badFunding}:
{observation:{chain:'mainnet',pool:'ironwood',...bindings,amountZat:10000,feeZat:10000,txid:body.txid,
outputIndex:0,blockHeight:3500000,blockHash:(options.block||'5').repeat(64),confirmations:3},
tipHeight:3500002,tipHash:(options.tip||'6').repeat(64),grossInputZat:20000};
const payload=JSON.stringify({nonce:options.badNonce||options.badNonceAt===n?'0'.repeat(64):envelope.nonce,
requestDigest:options.badDigest?'0'.repeat(64):crypto.createHash('sha256').update(envelope.body).digest('hex'),mode:body.mode,result});
const mac=crypto.createHmac('sha256',Buffer.from(envelope.sessionKey,'hex')).update(payload).digest('hex');
process.stderr.write('invented_private_stderr');
process.stdout.write(JSON.stringify({payload,mac:options.badMac?'0'.repeat(64):mac}));
`;
  writeFileSync(binary, source, { mode: 0o700 });
  chmodSync(binary, 0o700);
  return {
    root,
    binary,
    binarySha256: createHash("sha256").update(source).digest("hex"),
    walletRoot: join(root, "wallet"),
  };
}
function query() {
  return {
    receiver: "u1" + "q".repeat(80),
    reference: "a".repeat(32),
    bindingKey: "7".repeat(64),
    txid: "4".repeat(64),
    maxFeeZat: 10_000,
    maxDebitZat: 20_000,
    minConfirmations: 3,
  };
}
function database(path = ":memory:") {
  const db = new DatabaseSync(path);
  connections.push(db);
  return db;
}
function ready(db: DatabaseSync) {
  const journal = new ControlJournal(db);
  journal.recordApprovedPlan(plan);
  journal.reserveExternalSend(plan.id);
  journal.recordTxid(plan.id, query().txid);
  return journal;
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("private helper evidence and journal", () => {
  it("accepts two authenticated processes, persists the receipt and requires fresh evidence on recheck", () => {
    const config = fixture(),
      file = join(config.root, "journal.sqlite");
    const firstDb = database(file),
      firstJournal = ready(firstDb);
    const first = verifyWithHelper(config, query()),
      second = verifyWithHelper(config, query());
    firstJournal.recordRechecked(plan.id, first, second);
    expect(firstJournal.receipt(plan.id).confirmed).toBe(true);
    firstDb.close();
    connections.splice(connections.indexOf(firstDb), 1);
    const reopened = new ControlJournal(database(file));
    expect(reopened.receipt(plan.id).confirmed).toBe(true);
    reopened.beginRecheck(plan.id);
    expect(reopened.receipt(plan.id).confirmed).toBe(false);
    expect(() => reopened.recordRechecked(plan.id, first, second)).toThrow(
      "refused",
    );
    reopened.recordRechecked(
      plan.id,
      verifyWithHelper(config, query()),
      verifyWithHelper(config, query()),
    );
    expect(reopened.receipt(plan.id)).toEqual({
      state: "broadcast",
      candidateRecorded: true,
      confirmed: true,
      liveEvidenceVerified: true,
      compatibilityGatePassed: true,
    });
  });

  it("rejects plain JSON, a serialized proof, one-process replay and changed chain anchors", () => {
    const config = fixture(),
      journal = ready(database());
    const first = verifyWithHelper(config, query());
    const copy = JSON.parse(JSON.stringify(first)) as VerifiedControl;
    expect(() => journal.recordRechecked(plan.id, copy, copy)).toThrow(
      "refused",
    );
    expect(() => journal.recordRechecked(plan.id, first, first)).toThrow(
      "refused",
    );
    writeFileSync(config.binary + ".options", JSON.stringify({ block: "8" }));
    const changed = verifyWithHelper(config, query());
    expect(() => journal.recordRechecked(plan.id, first, changed)).toThrow(
      "refused",
    );
    expect(journal.receipt(plan.id).confirmed).toBe(false);
    expect(() => journal.reserveExternalSend(plan.id)).toThrow("refused");
  });

  it("rejects wrong MAC, request identity, nonce and binary hash without leaking private output", () => {
    const config = fixture();
    for (const options of [
      { badMac: true },
      { badDigest: true },
      { badNonce: true },
    ]) {
      writeFileSync(config.binary + ".options", JSON.stringify(options));
      expect(() => verifyWithHelper(config, query())).toThrow(
        "Private control verification refused.",
      );
    }
    expect(() =>
      verifyWithHelper({ ...config, binarySha256: "0".repeat(64) }, query()),
    ).toThrow("refused");
  });

  it("invalidates the prior receipt on a failed recheck and retains the original reservation", () => {
    const config = fixture(),
      db = database(),
      journal = ready(db);
    journal.recordRechecked(
      plan.id,
      verifyWithHelper(config, query()),
      verifyWithHelper(config, query()),
    );
    expect(journal.receipt(plan.id).confirmed).toBe(true);
    journal.beginRecheck(plan.id);
    writeFileSync(config.binary + ".options", JSON.stringify({ badMac: true }));
    expect(() => verifyWithHelper(config, query())).toThrow("refused");
    expect(journal.receipt(plan.id).confirmed).toBe(false);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM control_observations").get()?.n,
    ).toBe(1);
    expect(() => journal.reserveExternalSend(plan.id)).toThrow("refused");
  });
});

function operatorPackage() {
  const config = fixture();
  // This isolated build is produced before these integration tests in CI.
  const compiled = resolve(".build/control-operator/scripts/merchant-control");
  for (const name of ["journal.js", "verification.js"])
    cpSync(join(compiled, name), join(config.root, name));
  cpSync(
    resolve("scripts/merchant-control/operator.mjs"),
    join(config.root, "operator.mjs"),
  );
  cpSync(
    resolve("scripts/lightclient/node-runtime.mjs"),
    join(config.root, "node-runtime.mjs"),
  );
  writeFileSync(join(config.root, "package.json"), '{"type":"module"}');
  // The fake executable is CommonJS even inside this module-only package.
  const source = readFileSync(config.binary, "utf8").replace(
    "const fs=require",
    "const require=(await import('node:module')).createRequire(import.meta.url);const __filename=(await import('node:url')).fileURLToPath(import.meta.url);const fs=require",
  );
  writeFileSync(config.binary, source);
  chmodSync(config.binary, 0o700);
  config.binarySha256 = createHash("sha256").update(source).digest("hex");
  return { ...config, profile: join(config.root, "private-profile") };
}
function invoke(
  config: ReturnType<typeof operatorPackage>,
  mode: string,
  body: object,
) {
  const child = spawnSync(
    process.execPath,
    [
      join(config.root, "operator.mjs"),
      mode,
      config.profile,
      config.binarySha256,
    ],
    { input: JSON.stringify(body), encoding: "utf8", timeout: 15_000 },
  );
  expect(child.stderr).not.toContain("invented_private");
  return { code: child.status, result: JSON.parse(child.stdout) };
}
function prepare(config: ReturnType<typeof operatorPackage>) {
  mkdirSync(config.profile, { mode: 0o700 });
  expect(
    invoke(config, "prepare", {
      senderUfvk: "invented_private_sender",
      senderAddress: "invented_private_sender_ua",
      receiverUfvk: "invented_private_recipient",
      receiverAddress: "invented_private_recipient_ua",
      birthday: 3499990,
    }).code,
  ).toBe(0);
}

describe("private operator process integration with simulated SDK", () => {
  it("encrypts private preparation, reserves once, verifies twice and rechecks after reopening", () => {
    const config = operatorPackage();
    prepare(config);
    const encrypted = readFileSync(join(config.profile, "attempt.enc"));
    expect(encrypted.includes(Buffer.from("u1" + "q".repeat(80)))).toBe(false);
    expect(encrypted.includes(Buffer.from("invented_private"))).toBe(false);
    const handoff = invoke(config, "handoff", {
      approvalId: "approved_fixture_only",
    });
    expect(handoff.code).toBe(0);
    expect(handoff.result.reserved).toBe(true);
    expect(handoff.result.handoff.memo).toMatch(
      /^nostos:control:[a-f0-9]{32}$/,
    );
    expect(
      invoke(config, "handoff", { approvalId: "approved_fixture_only" }).code,
    ).toBe(1);
    expect(
      invoke(config, "verify", { txid: query().txid }).result.confirmed,
    ).toBe(true);
    expect(invoke(config, "recheck", {}).result.reopened).toBe(true);
    const db = database(join(config.profile, "control.sqlite"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM control_plans").get()?.n).toBe(
      1,
    );
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM control_observations").get()?.n,
    ).toBe(1);
  });

  it("holds insufficient funding and a failed second verification without a retry-send permission", () => {
    const config = operatorPackage();
    prepare(config);
    writeFileSync(
      config.binary + ".options",
      JSON.stringify({ badFunding: true }),
    );
    expect(
      invoke(config, "handoff", { approvalId: "approved_fixture_only" }).code,
    ).toBe(1);
    writeFileSync(config.binary + ".options", "{}");
    expect(
      invoke(config, "handoff", { approvalId: "approved_fixture_only" }).code,
    ).toBe(0);
    const count = Number(readFileSync(config.binary + ".count", "utf8"));
    writeFileSync(
      config.binary + ".options",
      JSON.stringify({ badNonceAt: count + 2 }),
    );
    expect(
      invoke(config, "verify", { txid: query().txid }).result.confirmed,
    ).toBe(false);
    const db = database(join(config.profile, "control.sqlite")),
      journal = new ControlJournal(db);
    expect(
      journal.receipt(
        db.prepare("SELECT id FROM control_plans").get()!.id as string,
      ).confirmed,
    ).toBe(false);
    expect(
      invoke(config, "handoff", { approvalId: "approved_fixture_only" }).code,
    ).toBe(1);
    writeFileSync(config.binary + ".options", "{}");
    expect(invoke(config, "recheck", {}).result.confirmed).toBe(true);
  });

  it("refuses exposed storage and hardlinks before modifying unrelated files", () => {
    const config = operatorPackage();
    mkdirSync(config.profile, { mode: 0o755 });
    expect(invoke(config, "prepare", {}).code).toBe(1);
    chmodSync(config.profile, 0o700);
    const victim = join(config.root, "untouched");
    writeFileSync(victim, "preserve", { mode: 0o600 });
    linkSync(victim, join(config.profile, "attempt.enc.tmp"));
    expect(invoke(config, "prepare", {}).code).toBe(1);
    expect(readFileSync(victim, "utf8")).toBe("preserve");
  });
  it("does not adopt an existing wallet directory without an authenticated control draft", () => {
    const config = operatorPackage();
    mkdirSync(config.profile, { mode: 0o700 });
    const wallet = join(config.profile, "wallet");
    mkdirSync(wallet, { mode: 0o700 });
    writeFileSync(join(wallet, "wallet.sqlite"), "preserve-existing-wallet", {
      mode: 0o600,
    });
    expect(invoke(config, "prepare", {}).code).toBe(1);
    expect(readFileSync(join(wallet, "wallet.sqlite"), "utf8")).toBe(
      "preserve-existing-wallet",
    );
    expect(existsSync(join(config.profile, "binding.key"))).toBe(false);
  });
});
