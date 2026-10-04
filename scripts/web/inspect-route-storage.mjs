// Read-only current database inspection. Reports counts, never addresses or memos.
import { DatabaseSync } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
const key = process.env.NOSTOS_PRODUCT_DATA_KEY;
if (!/^[a-f0-9]{64}$/.test(key ?? ""))
  throw new Error("Product key unavailable for protected-storage inspection.");
const report = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
let blockers = 0;
for (const [label, path] of [
  ["product", process.env.NOSTOS_PRODUCT_DATABASE_PATH],
  ["core", process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH],
]) {
  if (!path) {
    report({ database: label, read_ok: false });
    blockers++;
    continue;
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    for (const { name } of tables) {
      const columns = db
        .prepare("PRAGMA table_info(" + identifier(String(name)) + ")")
        .all();
      for (const { name: column } of columns) {
        if (
          !/^(route|refund_address|memo|memo_text|memo_hex|decoded_memo)$/i.test(
            String(column),
          )
        )
          continue;
        const rows = db
          .prepare(
            "SELECT " +
              identifier(String(column)) +
              " AS value FROM " +
              identifier(String(name)),
          )
          .all();
        let protectedCount = 0,
          emptyCount = 0,
          unprotectedCount = 0;
        for (const { value } of rows) {
          if (!value) {
            emptyCount++;
            continue;
          }
          try {
            const parts = String(value).split(".");
            if (parts.length !== 3) throw new Error();
            const [nonce, tag, body] = parts.map((x) =>
              Buffer.from(x, "base64url"),
            );
            const cipher = createDecipheriv(
              "aes-256-gcm",
              Buffer.from(key, "hex"),
              nonce,
            );
            cipher.setAuthTag(tag);
            Buffer.concat([cipher.update(body), cipher.final()]);
            protectedCount++;
          } catch {
            unprotectedCount++;
            blockers++;
          }
        }
        report({
          database: label,
          table: name,
          column,
          protected_count: protectedCount,
          empty_count: emptyCount,
          unprotected_or_invalid_count: unprotectedCount,
        });
      }
    }
  } finally {
    db.close();
  }
}
report({
  read_only: true,
  storage_check_passed: blockers === 0,
  scope:
    "Current route/memo columns only; logs, wallet history, WAL and backups have separate checks.",
});
if (blockers) process.exitCode = 1;
