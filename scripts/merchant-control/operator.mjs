// Invoked only by the reviewed terminal wrapper. Output is a private pipe.
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readFileSync,
  writeSync,
  fsyncSync,
  ftruncateSync,
  renameSync,
  readdirSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ControlJournal } from "./journal.js";
import {
  prepareWithHelper,
  preflightWithHelper,
  verifyWithHelper,
} from "./verification.js";
import { assertNodeRuntime } from "./node-runtime.mjs";

const failed = () => ({
  nostos_control_v1: true,
  passed: false,
  prepared: false,
  reserved: false,
  confirmed: false,
  reopened: false,
  spending_control_proven: false,
  outgoing_recovery_proven: false,
});
function refuse() {
  throw new Error("Private operator request refused.");
}
function privateFile(path) {
  const s = lstatSync(path);
  if (
    !s.isFile() ||
    s.uid !== process.getuid() ||
    s.nlink !== 1 ||
    s.mode & 0o077
  )
    refuse();
  return s;
}
function privateRead(path) {
  const before = privateFile(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = fstatSync(fd);
    if (after.ino !== before.ino || after.dev !== before.dev) refuse();
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function audit(root) {
  if (!isAbsolute(root) || realpathSync(root) !== root) refuse();
  for (let p = root; ; p = dirname(p)) {
    const s = lstatSync(p);
    if (
      !s.isDirectory() ||
      ![0, process.getuid()].includes(s.uid) ||
      (s.mode & 0o022 && !(s.uid === 0 && s.mode & 0o1000))
    )
      refuse();
    if (p === root && (s.uid !== process.getuid() || s.mode & 0o077)) refuse();
    if (dirname(p) === p) break;
  }
  const allowed = [
    "operator.lock",
    "binding.key",
    "attempt.enc",
    "attempt.enc.tmp",
    "control.sqlite",
    "control.sqlite-wal",
    "control.sqlite-shm",
    "control.sqlite-journal",
    "wallet",
  ];
  for (const name of readdirSync(root)) {
    if (!allowed.includes(name)) refuse();
    if (name === "wallet") {
      const s = lstatSync(join(root, name));
      if (
        !s.isDirectory() ||
        s.isSymbolicLink() ||
        s.uid !== process.getuid() ||
        s.mode & 0o077
      )
        refuse();
    } else privateFile(join(root, name));
  }
}
function createPrivate(path) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  return fd;
}
function writeAll(fd, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < data.length) {
    const count = writeSync(fd, data, offset, data.length - offset);
    if (count <= 0) refuse();
    offset += count;
  }
}
function exists(root, name) {
  return readdirSync(root).includes(name);
}
function keyFor(root, prepare) {
  const path = join(root, "binding.key");
  if (!exists(root, "binding.key")) {
    if (!prepare || exists(root, "attempt.enc")) refuse();
    const fd = createPrivate(path);
    try {
      writeAll(fd, randomBytes(32));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const key = privateRead(path);
  if (key.length !== 32) refuse();
  return key;
}
function encryptionKey(key) {
  return createHmac("sha256", key)
    .update("nostos-control-file-key-v1")
    .digest();
}
function save(root, key, draft) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), nonce);
  cipher.setAAD(Buffer.from("nostos-control-draft-v1"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(draft)),
    cipher.final(),
  ]);
  const data = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  const temporary = join(root, "attempt.enc.tmp");
  if (exists(root, "attempt.enc.tmp")) privateFile(temporary);
  const fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.nlink !== 1 ||
      s.mode & 0o077
    )
      refuse();
    ftruncateSync(fd, 0);
    writeAll(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, join(root, "attempt.enc"));
  const directory = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function load(root, key) {
  if (!exists(root, "attempt.enc")) return undefined;
  const data = privateRead(join(root, "attempt.enc"));
  if (data.length < 28 || data.length > 16_384) refuse();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(key),
    data.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from("nostos-control-draft-v1"));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
function database(root, prepare) {
  const path = join(root, "control.sqlite");
  if (!exists(root, "control.sqlite")) {
    if (!prepare) refuse();
    closeSync(createPrivate(path));
  }
  privateFile(path);
  return new DatabaseSync(path);
}
async function input() {
  let value = "";
  for await (const part of process.stdin) {
    value += part;
    if (Buffer.byteLength(value) > 16_384) refuse();
  }
  return JSON.parse(value);
}
let db;
try {
  assertNodeRuntime();
  if (process.argv.length !== 5) refuse();
  const [mode, root, binarySha256] = process.argv.slice(2);
  if (!["prepare", "handoff", "verify", "recheck"].includes(mode)) refuse();
  audit(root);
  if (
    !exists(root, "attempt.enc") &&
    exists(root, "wallet") &&
    readdirSync(join(root, "wallet")).length
  )
    refuse();
  const request = await input();
  const key = keyFor(root, mode === "prepare");
  let draft = load(root, key);
  db = database(root, mode === "prepare");
  let journal = new ControlJournal(db);
  const config = {
    binary: join(
      dirname(fileURLToPath(import.meta.url)),
      "nostos-control-check",
    ),
    binarySha256,
    walletRoot: join(root, "wallet"),
  };
  let result = failed();
  if (mode === "prepare") {
    if (draft?.approvalId) refuse();
    if (
      !Number.isInteger(request.birthday) ||
      request.birthday <= 0 ||
      request.birthday > 0xffff_ffff
    )
      refuse();
    if (!exists(root, "wallet")) mkdirSync(config.walletRoot, { mode: 0o700 });
    draft ??= {
      id: randomBytes(16).toString("hex"),
      reference: randomBytes(16).toString("hex"),
      birthday: request.birthday,
    };
    if (draft.birthday !== request.birthday) refuse();
    save(root, key, draft);
    const prepared = prepareWithHelper(config, {
      ...request,
      reference: draft.reference,
      bindingKey: key.toString("hex"),
    });
    if (
      draft.accountBinding &&
      ["accountBinding", "receiverBinding", "memoBinding"].some(
        (k) => draft[k] !== prepared[k],
      )
    )
      refuse();
    draft = { ...draft, ...prepared, prepared: true };
    save(root, key, draft);
    result = { ...failed(), passed: true, prepared: true };
  } else {
    if (!draft?.prepared) refuse();
    if (mode === "handoff") {
      if (
        typeof request.approvalId !== "string" ||
        !/^[a-zA-Z0-9_]{1,64}$/.test(request.approvalId)
      )
        refuse();
      if (draft.approvalId && draft.approvalId !== request.approvalId) refuse();
      const funding = preflightWithHelper(config, {
        receiver: draft.receiver,
        reference: draft.reference,
        bindingKey: key.toString("hex"),
      });
      if (
        ["accountBinding", "receiverBinding", "memoBinding"].some(
          (k) => funding[k] !== draft[k],
        )
      )
        refuse();
      draft.approvalId ??= request.approvalId;
      draft.approvedAt ??= new Date().toISOString();
      save(root, key, draft);
      journal.recordApprovedPlan({
        id: draft.id,
        merchantId: "operator_business",
        approvalId: draft.approvalId,
        approvedAt: draft.approvedAt,
        chain: "mainnet",
        pool: "ironwood",
        accountBinding: draft.accountBinding,
        receiverBinding: draft.receiverBinding,
        memoBinding: draft.memoBinding,
        amountZat: 10_000,
        maxFeeZat: 10_000,
        maxDebitZat: 20_000,
        minConfirmations: 3,
      });
      journal.reserveExternalSend(draft.id);
      result = {
        ...failed(),
        passed: true,
        prepared: true,
        reserved: true,
        handoff: {
          receiver: draft.receiver,
          memo: "nostos:control:" + draft.reference,
          amountZat: 10_000,
          maxFeeZat: 10_000,
          maxDebitZat: 20_000,
        },
      };
    } else {
      if (!draft.approvalId) refuse();
      journal.beginRecheck(draft.id);
      const txid = mode === "verify" ? request.txid : draft.txid;
      if (
        typeof txid !== "string" ||
        !/^[a-f0-9]{64}$/.test(txid) ||
        (draft.txid && draft.txid !== txid)
      )
        refuse();
      journal.recordTxid(draft.id, txid);
      draft.txid = txid;
      save(root, key, draft);
      const query = {
        receiver: draft.receiver,
        reference: draft.reference,
        bindingKey: key.toString("hex"),
        txid,
        maxFeeZat: 10_000,
        maxDebitZat: 20_000,
        minConfirmations: 3,
      };
      const first = verifyWithHelper(config, query);
      if (!journal.receipt(draft.id).candidateRecorded)
        journal.recordCandidate(draft.id, first.observation);
      db.close();
      db = database(root, false);
      journal = new ControlJournal(db);
      const second = verifyWithHelper(config, query);
      journal.recordRechecked(draft.id, first, second);
      if (!journal.receipt(draft.id).confirmed) refuse();
      result = {
        ...failed(),
        passed: true,
        prepared: true,
        reserved: true,
        confirmed: true,
        reopened: true,
        spending_control_proven: true,
        outgoing_recovery_proven: true,
      };
    }
  }
  db.close();
  db = undefined;
  audit(root);
  process.stdout.write(JSON.stringify(result));
} catch {
  try {
    db?.close();
  } catch {
    /* Fixed report only. */
  }
  process.stdout.write(JSON.stringify(failed()));
  process.exitCode = 1;
}
