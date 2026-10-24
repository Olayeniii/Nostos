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
import { SdkObserverClient } from "./sdk-observer.js";

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
export function sdkObserverSelected() {
  const backend = runtimeValue("NOSTOS_OBSERVER_BACKEND");
  if (backend && backend !== "zallet" && backend !== "sdk-preview")
    throw new ObserverError();
  if (
    backend === "sdk-preview" &&
    (runtimeNetwork() !== "mainnet" ||
      runtimeValue("NOSTOS_WALLET_MODE") !== "observer-preview")
  )
    throw new ObserverError();
  return backend === "sdk-preview";
}
export function observerWallet(merchantId?: string) {
  const url = runtimeValue("NOSTOS_OBSERVER_RPC_URL"),
    cookieFile = runtimeValue("NOSTOS_OBSERVER_RPC_COOKIE_FILE");
  if (
    !url ||
    !cookieFile ||
    url === runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_URL") ||
    cookieFile === runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE")
  )
    throw new ObserverError();
  if (sdkObserverSelected())
    return new SdkObserverClient(
      { url, cookieFile, timeoutMs: 15000 },
      merchantId ?? "",
    );
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
export function merchantStoreReady(store: ProductStore, merchantId: string) {
  const merchant = store.merchant(merchantId);
  if (!merchant) return false;
  if (merchant.destination) return true;
  if (runtimeNetwork() !== "mainnet" || !sdkObserverSelected()) return false;
  const connection = observerConnection(store, merchantId);
  return Boolean(
    merchant.emailVerifiedAt &&
      merchant.name.trim() &&
      !merchant.wallet &&
      connection?.state === "connected" &&
      connection.network === "mainnet",
  );
}

// Store metadata never turns observer access into a hosted signing account.
export function setupObserverStore(
  store: ProductStore,
  merchantId: string,
  name: string,
) {
  if (
    runtimeNetwork() !== "mainnet" ||
    !sdkObserverSelected() ||
    name.trim().length < 2 ||
    name.trim().length > 80
  )
    throw new ObserverError();
  schema(store);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const merchant = store.merchant(merchantId);
    const connection = observerConnection(store, merchantId);
    if (
      !merchant?.emailVerifiedAt ||
      merchant.wallet ||
      merchant.destination ||
      connection?.state !== "connected" ||
      connection.network !== "mainnet" ||
      !addressOnNetwork(connection.address, "mainnet")
    )
      throw new ObserverError();
    store.db
      .prepare(
        "UPDATE merchants SET name=? WHERE id=? AND wallet='' AND destination=''",
      )
      .run(store.encrypt(name.trim()), merchantId);
    store.db.exec("COMMIT");
  } catch {
    store.db.exec("ROLLBACK");
    throw new ObserverError();
  }
}
export async function connectObserver(
  store: ProductStore,
  merchantId: string,
  input: {
    password: unknown;
    viewingKey: unknown;
    birthday: unknown;
    consent: unknown;
    scopeConsent?: unknown;
  },
  rpc: ObserverRpc,
  node: Pick<WalletRpc, "call">,
) {
  const network = runtimeNetwork();
  const sdk = sdkObserverSelected();
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
    (sdk && input.scopeConsent !== true) ||
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
        "SELECT key_hash,birthday,consent_version FROM merchant_observers WHERE merchant_id=?",
      )
      .get(merchantId);
    if (
      row &&
      (row.key_hash !== fingerprint ||
        row.birthday !== birthday ||
        (sdk && row.consent_version !== "sdk-orchard-view-access-v1"))
    )
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
          sdk ? "sdk-orchard-view-access-v1" : consentVersion,
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

export type ObserverSyncStatus = {
  state: "ready" | "syncing";
  nodeHeight: number;
  scannedHeight: number | null;
  paymentsEnabled: false;
  signingEnabled: false;
};
// Readiness is a fresh observation, never a durable payment-enable flag.
export async function observerSyncStatus(
  store: ProductStore,
  merchantId: string,
  rpc: ObserverRpc,
): Promise<ObserverSyncStatus> {
  try {
    const merchant = store.merchant(merchantId);
    const connection = observerConnection(store, merchantId);
    if (
      !sdkObserverSelected() ||
      runtimeNetwork() !== "mainnet" ||
      !merchant?.emailVerifiedAt ||
      merchant.wallet ||
      merchant.destination ||
      connection?.state !== "connected" ||
      connection.network !== "mainnet"
    )
      throw new ObserverError();
    const row = store.db
      .prepare(
        "SELECT consent_version FROM merchant_observers WHERE merchant_id=?",
      )
      .get(merchantId);
    if (row?.consent_version !== "sdk-orchard-view-access-v1")
      throw new ObserverError();
    const status = await rpc.call<Record<string, unknown>>(
      "getwalletstatus",
      [],
    );
    const node = status.node_tip as {
      height?: unknown;
      blockhash?: unknown;
    } | null;
    const scanned = status.wallet_tip as {
      height?: unknown;
      blockhash?: unknown;
    } | null;
    const height = (n: unknown): n is number =>
      typeof n === "number" &&
      Number.isSafeInteger(n) &&
      n > 0 &&
      n <= 0xffffffff;
    const hash = (h: unknown): h is string =>
      typeof h === "string" && /^[a-f0-9]{64}$/.test(h);
    const fully = status.fully_synced_height;
    if (
      status.nostos_sdk_preview_v1 !== true ||
      status.payments_enabled !== false ||
      status.observation_scope !== "orchard-family-only" ||
      status.account_connected !== true ||
      typeof status.locked !== "boolean" ||
      !node ||
      !height(node.height) ||
      !hash(node.blockhash) ||
      !(fully === null || (height(fully) && fully <= node.height)) ||
      !(
        scanned === null ||
        (scanned &&
          height(scanned.height) &&
          scanned.height <= node.height &&
          hash(scanned.blockhash))
      )
    )
      throw new ObserverError();
    const ready =
      !status.locked &&
      fully === node.height &&
      scanned?.height === node.height &&
      scanned.blockhash === node.blockhash;
    return {
      state: ready ? "ready" : "syncing",
      nodeHeight: node.height,
      scannedHeight: typeof fully === "number" ? fully : null,
      paymentsEnabled: false,
      signingEnabled: false,
    };
  } catch {
    throw new ObserverError();
  }
}
export function observerRecordChecksEnabled() {
  return (
    runtimeValue("NOSTOS_OBSERVER_RECORD_CHECKS") === "yes" &&
    runtimeNetwork() === "mainnet" &&
    sdkObserverSelected()
  );
}
