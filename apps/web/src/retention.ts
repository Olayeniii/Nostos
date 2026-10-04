import { ProductStore } from "./product-store.js";
import { coreStore, retireExpiredCheckout } from "./product-service.js";

// No RPC and no spending. The product lock serializes expiry with customer requests.
export function retireExpiredProductRoutes(
  store: ProductStore,
  core: ReturnType<typeof coreStore>,
  now = Date.now(),
  cursor = { after: 0 },
) {
  let rows = store.db
    .prepare(
      "SELECT id,rowid AS position FROM checkouts WHERE rowid>? AND route<>'' AND payment_txid IS NOT NULL AND refund_expires_at IS NOT NULL AND refund_expires_at<=? ORDER BY rowid LIMIT 100",
    )
    .all(cursor.after, new Date(now).toISOString());
  if (!rows.length && cursor.after) {
    cursor.after = 0;
    rows = store.db
      .prepare(
        "SELECT id,rowid AS position FROM checkouts WHERE route<>'' AND payment_txid IS NOT NULL AND refund_expires_at IS NOT NULL AND refund_expires_at<=? ORDER BY rowid LIMIT 100",
      )
      .all(new Date(now).toISOString());
  }
  if (rows.length) cursor.after = Number(rows.at(-1)!.position);
  let retired = 0;
  for (const row of rows)
    if (retireExpiredCheckout(store, core, String(row.id), now)) retired++;
  return retired;
}

export function startProductRetention() {
  if (process.env.NOSTOS_RETENTION_ENABLED === "0") return;
  const cursor = { after: 0 };
  if (
    !process.env.NOSTOS_PRODUCT_DATABASE_PATH ||
    !process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH ||
    !process.env.NOSTOS_PRODUCT_DATA_KEY
  )
    return;
  const run = () => {
    let store: ProductStore | undefined,
      core: ReturnType<typeof coreStore> | undefined;
    try {
      store = new ProductStore();
      core = coreStore(store);
      retireExpiredProductRoutes(store, core, Date.now(), cursor);
    } catch {
      /* Retry on the next pass. Never log database contents or exception text. */
    } finally {
      core?.close();
      store?.close();
    }
  };
  run();
  const timer = setInterval(run, 300000);
  timer.unref();
}
