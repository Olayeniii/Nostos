import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const checkoutId = "27f5da23-15d3-4c5d-8d1f-3f253872cc5a";
describe.each([true, false])(
  "read-only refund evidence, additive ledger=%s",
  (hasLedger) => {
    it.each([
      [
        1800000,
        "confirmed",
        false,
        false,
        true,
        "remaining_refund_capability",
        "retained",
      ],
      [
        1800000,
        "failed",
        false,
        false,
        true,
        "remaining_refund_capability",
        "retained",
      ],
      [2000000, "confirmed", false, false, true, "fully_refunded", "due"],
      [2000000, "confirmed", false, false, false, "fully_refunded", "retired"],
      [1800000, "confirmed", true, false, true, "window_expired", "due"],
      [
        1800000,
        "confirmed",
        true,
        true,
        true,
        "open_customer_request",
        "retained",
      ],
      [
        1800000,
        "broadcasting",
        true,
        false,
        true,
        "unresolved_refund",
        "retained",
      ],
    ] as const)(
      "reports retention without changing data: %s/%s/%s/%s/%s",
      (amount, status, expired, open, present, reason, state) => {
        const dir = mkdtempSync(join(tmpdir(), "nostos-lifecycle-"));
        try {
          const product = join(dir, "product.sqlite"),
            core = join(dir, "core.sqlite");
          const sensitive = "private-route-memo-receipt-email";
          const p = new DatabaseSync(product);
          p.exec(`CREATE TABLE checkouts(id TEXT,amount_zat INTEGER,status TEXT,payment_txid TEXT,
        refund_expires_at TEXT,refund_window_days INTEGER,route_closed_reason TEXT,route TEXT,receipt_token TEXT);
        CREATE TABLE refund_requests(checkout_id TEXT,status TEXT,reason TEXT);`);
          p.prepare(
            "INSERT INTO checkouts VALUES(?,2000000,'confirmed',?,?,30,NULL,?,?)",
          ).run(
            checkoutId,
            "a".repeat(64),
            expired ? "2020-01-01T00:00:00.000Z" : "2100-01-01T00:00:00.000Z",
            present ? sensitive : "",
            sensitive,
          );
          if (open)
            p.prepare(
              "INSERT INTO refund_requests VALUES(?,'requested',?)",
            ).run(checkoutId, sensitive);
          p.close();
          const c = new DatabaseSync(core);
          c.exec(`CREATE TABLE payments(id TEXT,amount_zat INTEGER,confirmations INTEGER,status TEXT,
        refund_address TEXT,payment_txid TEXT);
        CREATE TABLE refund_events(id TEXT,payment_id TEXT,amount_zat INTEGER,status TEXT,
        txid TEXT,retry_count INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE refunds AS SELECT * FROM refund_events;`);
          c.prepare(
            "INSERT INTO payments VALUES('payment-id',2000000,3020,'confirmed',?,?)",
          ).run(present ? sensitive : "", "a".repeat(64));
          c.prepare(
            "INSERT INTO refund_events VALUES('refund-id','payment-id',?,?,?,0,'2026-10-04','2026-10-04')",
          ).run(
            amount,
            status,
            status === "broadcasting" ? null : "b".repeat(64),
          );
          c.exec("INSERT INTO refunds SELECT * FROM refund_events");
          if (!hasLedger) c.exec("DROP TABLE refund_events");
          c.close();
          const before = [readFileSync(product), readFileSync(core)];
          const run = spawnSync(
            process.execPath,
            hasLedger
              ? ["--input-type=module", "-", checkoutId]
              : ["scripts/web/inspect-refund-lifecycle.mjs", checkoutId],
            {
              input: hasLedger
                ? readFileSync(
                    "scripts/web/inspect-refund-lifecycle.mjs",
                    "utf8",
                  )
                : undefined,
              env: {
                ...process.env,
                NOSTOS_PRODUCT_DATABASE_PATH: product,
                NOSTOS_PRODUCT_CORE_DATABASE_PATH: core,
              },
              encoding: "utf8",
            },
          );
          expect(run.status).toBe(0);
          expect(run.stdout + run.stderr).not.toContain(sensitive);
          expect([readFileSync(product), readFileSync(core)]).toEqual(before);
          const result = JSON.parse(run.stdout);
          expect(result).toMatchObject({
            read_only: true,
            retention_reason: reason,
            retirement_state: state,
            remaining_payment_value_zat:
              status === "confirmed" ? 2000000 - amount : 2000000,
          });
          expect(result.refunds).toHaveLength(1);
          expect(result.refunds[0].id).toBe("refund-id");
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
    it("uses fixed errors without printing configuration or raw SQLite errors", () => {
      const run = spawnSync(
        process.execPath,
        ["scripts/web/inspect-refund-lifecycle.mjs", checkoutId],
        {
          env: {
            ...process.env,
            NOSTOS_PRODUCT_DATABASE_PATH: "/private-wallet-secret/missing",
            NOSTOS_PRODUCT_CORE_DATABASE_PATH: "/missing",
          },
          encoding: "utf8",
        },
      );
      expect(run.status).toBe(1);
      expect(JSON.parse(run.stdout)).toEqual({
        read_only: true,
        inspection_failed: true,
      });
      expect(run.stdout + run.stderr).not.toContain("private-wallet-secret");
    });
  },
);
