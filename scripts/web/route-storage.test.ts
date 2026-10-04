import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
it("read-only storage check accepts protected routes and reports plaintext without revealing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "nostos-storage-")),
    key = "f".repeat(64),
    secret = "utest1" + "z".repeat(60);
  try {
    const product = join(dir, "product.sqlite"),
      core = join(dir, "core.sqlite");
    const db = new DatabaseSync(product);
    db.exec("CREATE TABLE checkouts(route TEXT NOT NULL)");
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce),
      body = Buffer.concat([cipher.update(secret), cipher.final()]);
    const encrypted = [nonce, cipher.getAuthTag(), body]
      .map((v) => v.toString("base64url"))
      .join(".");
    db.prepare("INSERT INTO checkouts VALUES(?)").run(encrypted);
    db.close();
    const c = new DatabaseSync(core);
    c.exec("CREATE TABLE payments(refund_address TEXT NOT NULL)");
    c.prepare("INSERT INTO payments VALUES(?)").run("");
    c.close();
    const env = {
      ...process.env,
      NOSTOS_PRODUCT_DATA_KEY: key,
      NOSTOS_PRODUCT_DATABASE_PATH: product,
      NOSTOS_PRODUCT_CORE_DATABASE_PATH: core,
    };
    const before = readFileSync(product),
      check = () =>
        spawnSync(process.execPath, ["scripts/web/inspect-route-storage.mjs"], {
          env,
          encoding: "utf8",
        });
    const good = check();
    expect(good.status).toBe(0);
    expect(good.stdout).toContain('"storage_check_passed":true');
    expect(good.stdout).not.toContain(secret);
    expect(readFileSync(product)).toEqual(before);
    const legacy = new DatabaseSync(core);
    legacy.prepare("INSERT INTO payments VALUES(?)").run(secret);
    legacy.close();
    const bad = check();
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('"unprotected_or_invalid_count":1');
    expect(bad.stdout).not.toContain(secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
