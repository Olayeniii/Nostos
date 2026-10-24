import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSavedWalletBinding,
  report,
} from "./check-saved-wallet-binding.mjs";

function fixture() {
  const review = mkdtempSync(join(tmpdir(), "nostos-binding-"));
  const key = Buffer.alloc(32, 7),
    viewing = "uview1" + "a".repeat(140);
  const saved = "u1" + "b".repeat(60),
    displayed = "u1" + "c".repeat(60);
  const encrypt = (value) => {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), bytes]
      .map((v) => v.toString("base64url"))
      .join(".");
  };
  mkdirSync(join(review, "runtime/data"), { recursive: true, mode: 0o700 });
  const config = join(review, "runtime/web.env"),
    database = join(review, "runtime/data/product.sqlite");
  writeFileSync(
    config,
    "NOSTOS_MAINNET_PRODUCT_DATA_KEY=" + key.toString("hex") + "\n",
    { mode: 0o600 },
  );
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE merchants(id TEXT,email_verified_at TEXT,wallet TEXT,destination TEXT);
    CREATE TABLE merchant_observers(merchant_id TEXT,status TEXT,network TEXT,consent_version TEXT,viewing_key TEXT,destination TEXT,key_hash TEXT,account TEXT);
    INSERT INTO merchants VALUES('fixture','verified','','');`);
  db.prepare(
    "INSERT INTO merchant_observers VALUES('fixture','connected','mainnet','sdk-orchard-view-access-v1',?,?,?,?)",
  ).run(
    encrypt(viewing),
    encrypt(saved),
    createHmac("sha256", key)
      .update("observer:mainnet:" + viewing)
      .digest("hex"),
    encrypt("4b723cba-3e4d-4536-9c2e-e8129e2fb731"),
  );
  db.close();
  chmodSync(database, 0o600);
  const binary = join(review, "checker");
  writeFileSync(
    binary,
    `#!${process.execPath}
const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));
const passed=input.ufvk===${JSON.stringify(viewing)}&&${JSON.stringify([saved, displayed])}.includes(input.address);
console.log(JSON.stringify({nostos_offline_binding_v1:true,passed,offline:true,key_imported:false,spending_control_proven:false,outgoing_recovery_proven:false}));process.exit(passed?0:1);`,
    { mode: 0o700 },
  );
  const input = {
    review,
    binary,
    sha256: createHash("sha256").update(readFileSync(binary)).digest("hex"),
    displayAddress: displayed,
  };
  return {
    review,
    input,
    config,
    database,
    saved,
    displayed,
    viewing,
    change(sql) {
      const db = new DatabaseSync(database);
      db.exec(sql);
      db.close();
    },
    close() {
      rmSync(review, { recursive: true, force: true });
    },
  };
}

test("checks saved and rotated display addresses in memory without changing saved files", () => {
  const f = fixture();
  try {
    const before = [readFileSync(f.database), readFileSync(f.config)];
    const value = checkSavedWalletBinding(f.input);
    assert.deepEqual(value, report("complete", true, true));
    assert.deepEqual(readFileSync(f.database), before[0]);
    assert.deepEqual(readFileSync(f.config), before[1]);
    assert.ok(!JSON.stringify(value).includes(f.saved));
    assert.ok(!JSON.stringify(value).includes(f.displayed));
    assert.ok(!JSON.stringify(value).includes(f.viewing));
  } finally {
    f.close();
  }
});
test("rejects another wallet display address after the saved address passes", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      checkSavedWalletBinding({
        ...f.input,
        displayAddress: "u1" + "d".repeat(60),
      }),
      report("zodl_address", true, false),
    );
  } finally {
    f.close();
  }
});
test("rejects binary hash mismatch before reading saved wallet data", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      checkSavedWalletBinding({ ...f.input, sha256: "0".repeat(64) }),
      report("preflight"),
    );
  } finally {
    f.close();
  }
});
for (const [name, sql, stage] of [
  [
    "pending import",
    "UPDATE merchant_observers SET status='importing'",
    "saved_connection",
  ],
  [
    "unverified merchant",
    "UPDATE merchants SET email_verified_at=NULL",
    "saved_connection",
  ],
  ["hosted wallet", "UPDATE merchants SET wallet='hosted'", "saved_connection"],
  [
    "wrong consent",
    "UPDATE merchant_observers SET consent_version='other'",
    "saved_connection",
  ],
  [
    "changed fingerprint",
    "UPDATE merchant_observers SET key_hash='changed'",
    "saved_key",
  ],
  [
    "tampered encryption",
    "UPDATE merchant_observers SET [viewing_key]='broken'",
    "saved_key",
  ],
  [
    "ambiguous connections",
    "INSERT INTO merchant_observers SELECT * FROM merchant_observers",
    "saved_connection",
  ],
])
  test(`rejects ${name} without private output`, () => {
    const f = fixture();
    try {
      f.change(sql);
      assert.deepEqual(checkSavedWalletBinding(f.input), report(stage));
    } finally {
      f.close();
    }
  });
test("rejects permissive credentials and raw checker output", () => {
  const f = fixture();
  try {
    chmodSync(f.config, 0o644);
    assert.deepEqual(checkSavedWalletBinding(f.input), report("preflight"));
    chmodSync(f.config, 0o600);
    writeFileSync(
      f.input.binary,
      `#!${process.execPath}\nconsole.log("private fixture must never escape");`,
      { mode: 0o700 },
    );
    f.input.sha256 = createHash("sha256")
      .update(readFileSync(f.input.binary))
      .digest("hex");
    assert.deepEqual(checkSavedWalletBinding(f.input), report("saved_address"));
  } finally {
    f.close();
  }
});
