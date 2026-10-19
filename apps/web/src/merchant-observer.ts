import {
  runtimeNetwork,
  runtimeValue,
  addressOnNetwork,
} from "../../../packages/network/src/index.js";
import { ZalletRpcClient } from "../../../packages/zcash-adapter/src/index.js";
import { prepareOrchardRefundRoute } from "../../../packages/zcash-adapter/src/refund-route.js";
import { type ProductStore } from "./product-store.js";
import { reauthenticated } from "./merchant-identity.js";
import { assertWalletChainIdentity, type WalletRpc } from "./wallet-runtime.js";

export class ObserverError extends Error {
  constructor() {
    super(
      "Wallet connection could not be verified. Check the dedicated business viewing key, birthday and observer readiness. Keep any pending connection and retry only the same details.",
    );
  }
}
export type ObserverRpc = Pick<
  ZalletRpcClient,
  "call" | "decodeUnifiedAddress"
>;
const consentVersion = "business-full-viewing-key-v1";
export function observerWallet() {
  const url = runtimeValue("NOSTOS_OBSERVER_RPC_URL"),
    cookieFile = runtimeValue("NOSTOS_OBSERVER_RPC_COOKIE_FILE");
  if (
    !url ||
    !cookieFile ||
    url === runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_URL") ||
    cookieFile === runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE")
  )
    throw new ObserverError();
  return new ZalletRpcClient({ url, cookieFile, timeoutMs: 15000 });
}
function schema(store: ProductStore) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS merchant_observers (
    merchant_id TEXT PRIMARY KEY REFERENCES merchants(id), network TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, viewing_key TEXT NOT NULL, birthday INTEGER NOT NULL,
    consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('importing','connected')),
    account TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT ''
  )`);
}
export function observerConnection(store: ProductStore, merchantId: string) {
  schema(store);
  const row = store.db
    .prepare(
      "SELECT network,status,destination FROM merchant_observers WHERE merchant_id=?",
    )
    .get(merchantId);
  return row
    ? {
        state: String(row.status),
        network: String(row.network),
        address: store.decrypt(String(row.destination)),
        observerOnly: true,
        paymentsEnabled: false,
        syncVerified: false,
      }
    : null;
}
export async function connectObserver(
  store: ProductStore,
  merchantId: string,
  input: {
    password: unknown;
    viewingKey: unknown;
    birthday: unknown;
    consent: unknown;
  },
  rpc: ObserverRpc,
  node: Pick<WalletRpc, "call">,
) {
  const network = runtimeNetwork();
  const merchant = store.merchant(merchantId);
  if (
    typeof input.password !== "string" ||
    input.password.length > 128 ||
    !reauthenticated(store, merchantId, input.password)
  )
    throw new ObserverError();
  // Existing hosted accounts cannot be converted or mixed with new observer keys.
  if (
    !merchant ||
    merchant.wallet ||
    merchant.destination ||
    input.consent !== true ||
    typeof input.viewingKey !== "string" ||
    !new RegExp(
      `^${network === "mainnet" ? "uview1" : "uviewtest1"}[a-z0-9]{20,3000}$`,
    ).test(input.viewingKey) ||
    typeof input.birthday !== "number" ||
    !Number.isSafeInteger(input.birthday) ||
    input.birthday <= 0 ||
    input.birthday > 0xffffffff
  )
    throw new ObserverError();
  const key = input.viewingKey,
    birthday = input.birthday;
  schema(store);
  const fingerprint = store.fingerprint("observer:" + network + ":" + key);
  // Durable claim precedes the first RPC. Timeouts retain the encrypted key;
  // changing the key/birthday or claiming another merchant's key is rejected.
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const row = store.db
      .prepare(
        "SELECT key_hash,birthday FROM merchant_observers WHERE merchant_id=?",
      )
      .get(merchantId);
    if (row && (row.key_hash !== fingerprint || row.birthday !== birthday))
      throw new ObserverError();
    if (!row)
      store.db
        .prepare(
          "INSERT INTO merchant_observers(merchant_id,network,key_hash,viewing_key,birthday,consent_version,consent_at,status) VALUES(?,?,?,?,?,?,?,'importing')",
        )
        .run(
          merchantId,
          network,
          fingerprint,
          store.encrypt(key),
          birthday,
          consentVersion,
          new Date().toISOString(),
        );
    store.db.exec("COMMIT");
  } catch {
    store.db.exec("ROLLBACK");
    throw new ObserverError();
  }
  try {
    await assertWalletChainIdentity(rpc, node);
    const imported = await rpc.call<{
      address_type: string;
      address: string;
      account_uuid: string;
      nostos_view_only_v1: boolean;
    }>("z_importviewingkey", [key, "whenkeyisnew", birthday]);
    if (
      imported.nostos_view_only_v1 !== true ||
      imported.address_type !== "unified" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        imported.account_uuid,
      ) ||
      !addressOnNetwork(imported.address, network)
    )
      throw new ObserverError();
    const address = await prepareOrchardRefundRoute(imported.address, rpc);
    if (address !== imported.address) throw new ObserverError();
    store.db
      .prepare(
        "UPDATE merchant_observers SET status='connected',account=?,destination=? WHERE merchant_id=? AND key_hash=?",
      )
      .run(
        store.encrypt(imported.account_uuid),
        store.encrypt(address),
        merchantId,
        fingerprint,
      );
    return observerConnection(store, merchantId)!;
  } catch {
    throw new ObserverError();
  }
}
