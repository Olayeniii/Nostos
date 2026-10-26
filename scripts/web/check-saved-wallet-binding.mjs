// No RPC, wallet import or signer. Private values stay in stdin and memory.
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function report(stage, saved = false, displayed = false) {
  return {
    read_only: true,
    offline: true,
    stage,
    saved_address_matches: saved,
    zodl_address_matches: displayed,
    same_account: saved && displayed,
    spending_control_proven: false,
    services_changed: false,
    sends_requested: 0,
  };
}
function requireValue(value) {
  if (!value) throw Error();
}
function protectedFile(path, maximum, executable = false) {
  requireValue(isAbsolute(path) && realpathSync(path) === path);
  const info = lstatSync(path);
  requireValue(
    info.isFile() &&
      info.uid === process.getuid() &&
      info.nlink === 1 &&
      !(info.mode & (executable ? 0o022 : 0o077)) &&
      info.size <= maximum,
  );
  if (executable) requireValue(Boolean(info.mode & 0o100));
}
function decrypt(encoded, key) {
  requireValue(typeof encoded === "string" && encoded.length < 10000);
  const parts = encoded.split(".");
  requireValue(parts.length === 3);
  const [nonce, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
  requireValue(nonce.length === 12 && tag.length === 16);
  const cipher = createDecipheriv("aes-256-gcm", key, nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
function nativeCheck(binary, key, address) {
  const result = spawnSync(binary, [], {
    input: JSON.stringify({ ufvk: key, address }),
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024,
    stdio: ["pipe", "pipe", "ignore"],
    env: { LANG: "C" },
  });
  if (result.error || ![0, 1].includes(result.status)) return false;
  try {
    const value = JSON.parse(result.stdout);
    const expected = {
      nostos_offline_binding_v1: true,
      passed: true,
      offline: true,
      key_imported: false,
      spending_control_proven: false,
      outgoing_recovery_proven: false,
    };
    return (
      result.status === 0 &&
      Object.keys(value).length === Object.keys(expected).length &&
      Object.entries(expected).every(([k, v]) => value[k] === v)
    );
  } catch {
    return false;
  }
}
export function checkSavedWalletBinding({
  review,
  binary,
  sha256,
  displayAddress,
}) {
  let stage = "preflight",
    saved = false;
  try {
    requireValue(
      typeof review === "string" &&
        isAbsolute(review) &&
        realpathSync(review) === review,
    );
    const info = lstatSync(review);
    requireValue(
      info.isDirectory() &&
        info.uid === process.getuid() &&
        !(info.mode & 0o077),
    );
    requireValue(
      typeof displayAddress === "string" &&
        /^u1[a-z0-9]{20,500}$/.test(displayAddress),
    );
    requireValue(typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256));
    protectedFile(binary, 200000000, true);
    requireValue(
      createHash("sha256").update(readFileSync(binary)).digest("hex") ===
        sha256,
    );
    const config = join(review, "runtime/web.env"),
      database = join(review, "runtime/data/product.sqlite");
    protectedFile(config, 65536);
    protectedFile(database, 1000000000);
    const configLines = readFileSync(config, "utf8").split(/\r?\n/);
    const values = configLines.filter((line) =>
      line.startsWith("NOSTOS_MAINNET_PRODUCT_DATA_KEY="),
    );
    requireValue(values.length === 1);
    const encodedKey = values[0].slice(
      "NOSTOS_MAINNET_PRODUCT_DATA_KEY=".length,
    );
    requireValue(/^[a-f0-9]{64}$/.test(encodedKey));
    const key = Buffer.from(encodedKey, "hex");
    stage = "saved_connection";
    const db = new DatabaseSync(database, { readOnly: true });
    let rows;
    try {
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
      rows = db
        .prepare(
          `SELECT o.viewing_key,o.destination,o.key_hash,o.account FROM merchant_observers o
        JOIN merchants m ON m.id=o.merchant_id WHERE o.status='connected' AND o.network='mainnet'
        AND o.consent_version='sdk-orchard-view-access-v1' AND m.email_verified_at IS NOT NULL
        AND m.wallet='' AND m.destination='' LIMIT 2`,
        )
        .all();
    } finally {
      db.close();
    }
    requireValue(rows.length === 1);
    stage = "saved_key";
    const viewingKey = decrypt(rows[0].viewing_key, key);
    requireValue(/^uview1[a-z0-9]{20,3000}$/.test(viewingKey));
    requireValue(
      createHmac("sha256", key)
        .update("observer:mainnet:" + viewingKey)
        .digest("hex") === rows[0].key_hash,
    );
    const account = decrypt(rows[0].account, key);
    requireValue(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(account));
    const address = decrypt(rows[0].destination, key);
    requireValue(/^u1[a-z0-9]{20,500}$/.test(address));
    stage = "saved_address";
    saved = nativeCheck(binary, viewingKey, address);
    requireValue(saved);
    stage = "zodl_address";
    requireValue(nativeCheck(binary, viewingKey, displayAddress));
    return report("complete", true, true);
  } catch {
    return report(stage, saved, false);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const bytes = readFileSync(0);
    requireValue(bytes.length <= 8192);
    process.stdout.write(
      JSON.stringify(checkSavedWalletBinding(JSON.parse(bytes))) + "\n",
    );
  } catch {
    process.stdout.write(JSON.stringify(report("preflight")) + "\n");
  }
}
