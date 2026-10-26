// Private operator entry point. Metadata only on stdin, never a wallet database.
// No signing/broadcast methods. Dry-run unless --apply is explicitly supplied.
import { readFileSync } from "node:fs";
import { ProductStore } from "/app/apps/web/src/product-store.ts";
import { coreStore } from "/app/apps/web/src/product-service.ts";
import { recoverExpiredObservedRefund } from "/app/apps/web/src/observer-records.ts";

let store, core;
try {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && !["--dry-run", "--apply"].includes(args[0]))
  )
    throw Error();
  const input = readFileSync(0);
  if (input.length > 4096) throw Error();
  const evidence = JSON.parse(input.toString("utf8"));
  store = new ProductStore();
  core = coreStore(store);
  const plans = core
    .withdrawalDatabase()
    .prepare(
      "SELECT merchant_id,request_id,memo FROM observer_record_instructions WHERE kind='refund' LIMIT 101",
    )
    .all();
  if (plans.length > 100) throw Error();
  const matches = plans.filter(
    (plan) => store.decrypt(plan.memo) === evidence.memo,
  );
  // Repeated application finds the old encrypted memo in the append-only history.
  if (
    !matches.length &&
    core
      .withdrawalDatabase()
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='observer_refund_attempt_history'",
      )
      .get()
  ) {
    const history = core
      .withdrawalDatabase()
      .prepare(
        "SELECT i.merchant_id,i.request_id,h.old_memo AS memo FROM observer_refund_attempt_history h JOIN observer_record_instructions i ON i.id=h.instruction_id WHERE h.expired_txid=?",
      )
      .all(evidence.txid);
    matches.push(
      ...history.filter((row) => store.decrypt(row.memo) === evidence.memo),
    );
  }
  if (matches.length !== 1) throw Error();
  const plan = matches[0];
  const result = await recoverExpiredObservedRefund(
    store,
    core,
    plan.merchant_id,
    plan.request_id,
    evidence,
    args[0] === "--apply",
  );
  process.stdout.write(JSON.stringify(result) + "\n");
} catch {
  process.stdout.write(
    JSON.stringify({
      recoveryStopped: true,
      sendsRequested: 0,
      message:
        "Recovery checks did not pass. Preserve the reservation and inspect current chain, observer and saved instruction state.",
    }) + "\n",
  );
  process.exitCode = 1;
} finally {
  core?.close();
  store?.close();
}
