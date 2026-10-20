# Mainnet through a hosted node

**Custody decision update:** Follow [MERCHANT_CUSTODY.md](MERCHANT_CUSTODY.md).
The operator wallet bring-up below is historical infrastructure preparation, not
the approved merchant custody model. Keep that wallet unfunded and stopped.
Hosted merchant operations on mainnet are now blocked in the application.

NOSTOS does not require the operator to host a full node. The chosen first path
keeps a separate mainnet Zallet wallet and signing keys locally, with hosted
Zebra JSON-RPC supplying public chain data and accepting already-signed
transactions. The existing testnet services, Item21 records and encrypted routes
are unchanged. No additional full-chain disk volume is required by this design;
wallet/indexer cache growth and provider quotas still require runtime checks.

The organizer resource list includes Zcash developer docs, ZIPs, librustzcash,
Zebra and the ZODL reference wallet. These are implementation resources, not a
requirement to self-host Zebra. The Rust wallet backend also supports lightwalletd
clients; changing the existing Zallet adapter to a new wallet implementation is a
separate option, not a requirement for the hosted-node connection below.

## Source-reviewed path

The current Zallet `v0.1.0-beta.3` Zaino backend accepts a validator JSON-RPC
address and runs finalized-state indexing ephemerally rather than persisting a
full-node database. Its native validator connection uses HTTP and host:port,
so a token-bearing hosted HTTPS URL cannot simply be pasted into that setting.
A small authenticated relay keeps the wallet and application RPC on loopback and
uses verified HTTPS to reach the provider. It is not a full node and stores no
chain database. No wallet RPC or signing key goes to the provider.

GetBlock's current documentation describes Zcash mainnet served by Zebra with
Ironwood support. This is a documented candidate, not a verified endpoint or an
assumption that every account plan exposes the same RPCs. The initial connector
accepts only its documented Frankfurt HTTPS JSON-RPC endpoint. It does not accept
Blockbook REST/WebSocket endpoints, a bare API key, arbitrary hosts or redirects.
Provider selection, cost, quotas, RPC response decoding and actual wallet sync
must be verified with the operator's endpoint.

Sources reviewed on 19 October 2026:

- <https://docs.getblock.io/api-reference/zcash-zec>
- <https://github.com/zcash/zallet/blob/v0.1.0-beta.3/backends/zaino/src/chain.rs>
- <https://github.com/zcash/zallet/blob/v0.1.0-beta.3/backends/zebra/tests/cmd/example_config.out/zallet.toml>
- <https://zcash.github.io/librustzcash/rustdoc/latest/zcash_client_backend/index.html>

## First operator step: metadata probe only

Create a **Zcash mainnet JSON-RPC** endpoint in the provider account. Check its
current plan/cost and quota before enabling it. Keep the complete token-bearing
URL private: do not paste it in chat, Git, shell arguments or screenshots.

From the existing source checkout, at the normal shell prompt:

```bash
cd ~/nostos/repo
git pull --ff-only origin main
python3 scripts/web/configure-hosted-node.py
```

At `Paste hosted Zcash MAINNET JSON-RPC URL (hidden):`, paste the complete HTTPS
endpoint URL. Input is hidden. This default operation does not save the URL,
create files, install a service, create a wallet, sign or send a transaction.
It prints redacted JSON only, including the checked method names and public tip
height. Provider errors, headers, token URLs and raw block/transaction data are
not printed. Ctrl+C exits before setup; the failure output reports no send.

The probe checks mainnet identity and upgrade metadata, tip hash consistency,
verbose/raw blocks, block headers, raw mempool, shielded tree/subtree methods for
Sapling/Orchard/Ironwood and raw transaction access for an existing public block.
These are public-chain reads; no customer or merchant wallet data is queried.
A missing pool/method or incompatible shape fails closed. The probe does not send
a dummy transaction to test broadcast. It does not prove wallet sync, validate
all Rust/Zaino response decoding, or independently validate consensus.

## Install only the lightweight connector

After a passing probe, installation is an explicit separate command:

```bash
sudo python3 scripts/web/configure-hosted-node.py --install
```

Paste the same provider endpoint privately when prompted. The probe runs again
before changes. The installer creates root-only `mainnet/hosted-node.json` outside
Git, a new random local RPC cookie in `mainnet/node-rpc/.cookie`, the root-owned
relay source under `/usr/local/lib/nostos`, and
`nostos-mainnet-rpc-relay.service`. The service binds only 127.0.0.1:38231.
It starts only the new relay, never testnet Zebra, wallets or either web runtime.
Existing credentials/configuration are never overwritten. If installation fails,
some files or the service may already exist; inspect privately before repeating.
Do not remove data or reset configuration to make a retry appear clean.

Systemd passes provider settings and the local cookie with `LoadCredential` to a
sandboxed dynamic user. Provider settings are absent from command arguments and
service environment values. The local cookie is readable only by the numeric web
UID and systemd's credential loader. A separate mainnet wallet will need managed
read access to this local cookie, not to the provider URL or any testnet cookie.
No wallet spending seed is created or copied by this tool.

The relay authenticates local callers, rejects browser-origin requests, bounds
connections/request sizes/timeouts, disables environment HTTP proxies and follows
no redirect. It never forwards local Basic authorization upstream or logs HTTP
bodies. Upstream error text is replaced with a fixed failure. Provider TLS
certificates and hostnames are verified by Python's standard trust store.

## Remaining mainnet bring-up

The relay starts with **broadcast disabled**. Node read access is not permission
to spend. A later separately authorized mainnet proof needs explicit enablement
of signed-transaction forwarding and readiness checks first. The relay's
`broadcast_enabled` configuration controls only `sendrawtransaction`; it cannot
create a transaction or access keys. No other wallet or signing methods are
accepted in either mode.

Provision a new mainnet Zallet wallet using the existing compatible binary and
upstream wallet initialization/backup instructions. Do not reuse or change the
current testnet wallet directory, seeds, services, ports or database. Preserve the
upstream backup requirement; never bypass it. The new wallet's indexer uses
`validator_address = "127.0.0.1:38231"` and the relay's local cookie path. Set the
consensus network to `main`, with the version's complete configuration and a
separate wallet RPC bind. This document does not claim that initialization,
backup confirmation or wallet sync has occurred.

The mainnet application's chain settings then use
`NOSTOS_MAINNET_CHAIN_RPC_URL=http://127.0.0.1:38231` and the existing mainnet
container cookie mount `/wallet/node/.cookie`. The mainnet deployment remains
separate on ports 3100/3101 with its own encryption key, databases and HTTPS
hostname. Follow [MERCHANT_FUNDS.md](MERCHANT_FUNDS.md) for those boundaries.
Do not deploy or fund an unverified wallet. Hosted RPC compatibility, complete
wallet sync and the merchant controls must pass before a separately authorized
small payment/refund/withdrawal proof.

## Privacy boundary

Keys, memo decryption, merchant accounts and refund authorization remain in the
hosted merchant wallet controlled by the NOSTOS operator. The node provider sees
the relay's IP, request timing, queried public block/transaction references and
broadcast encrypted transaction bytes. Shielded encryption does not hide this
connection metadata. This is not operator blindness, merchant self-custody or an
unlinkability guarantee. The existing logs, wallet history, WAL/SHM and backup
review remains required and must include the new relay/provider boundary.

Local tests and a successful probe cannot establish a live mainnet payment,
refund, withdrawal or final privacy/submission readiness.

## October 20 observer startup compatibility repair

The operator verified native ARM artifact 12221416956 from successful workflow
39321077735, installed it separately and confirmed version 0.1.0-beta.3. The new
observer has an encryption identity but no generated mnemonic or imported merchant
key. Its first startup stayed before wallet RPC initialization. A bounded probe
logged `Starting Zaino indexer`, and left the observer stopped. The relay's
`getinfo` read passed separately. No key import, wallet sync or mainnet payment is
proved.

Pinned Zaino d2d06bdd serializes Rust unit parameters as JSON `null` for
`getrawmempool`, `getbestblockhash`, `getblockcount` and other no-argument reads.
Its mempool initialization retries a rejected read before opening wallet RPC.
The earlier relay rejected every non-array parameter value. The repair normalizes
`null` to `[]` only for the six existing no-argument read methods. It adds no
method permissions. Argument-bearing calls and broadcasts still require arrays;
wallet methods, credentials, redirects, TLS and default-disabled broadcasts retain
their existing checks.

After reviewing/pulling this repair, with the new observer stopped:

```bash
sudo python3 scripts/web/update-hosted-node.py
sudo python3 scripts/web/update-hosted-node.py --apply
```

The first invocation is read-only. Explicit apply preserves the old installed code,
atomically replaces only the relay script, and restarts only
`nostos-mainnet-rpc-relay.service`. It preserves the provider configuration, cookie
and unit file. If the relay restart fails, it restores the old script and attempts
to start that version. Inspect the returned state before any further startup;
`is-active` is not RPC, sync or payment proof. Testnet wallets, Zebra and web
services are never operated by this helper. Runtime repair and an actual
observer connection remain unverified until operator evidence is returned.

Upstream source reviewed: <https://github.com/zodl-inc/zaino/blob/d2d06bdd/packages/zaino-fetch/src/jsonrpsee/connector.rs>
and <https://github.com/zodl-inc/zaino/blob/d2d06bdd/packages/zaino-state/src/chain_index/mempool.rs>.

## Observer-only web preview

The earlier mainnet deploy profile expected an operator signing wallet. The
explicit `observer-preview` mode now allows the account and view-access pages to
start with a separate observer RPC and no merchant signing RPC configuration.
It retains the unconditional hosted-mainnet operation hold. The web mode flag
`NOSTOS_MAINNET_ENABLED=yes` enables the isolated application profile, not payments,
refunds, withdrawals or hosted store creation. No environment flag releases the
custody hold. Unknown wallet modes and signer configuration in preview are
rejected.

Prepare a separate HTTPS origin, for example `https://mainnet.nostos.iyforge.xyz`.
DNS and TLS must be configured and verified before entering any viewing key.
The testnet origin and its existing web deployment must remain separate.

With the observer running, first run the read-only preflight:

```bash
cd ~/nostos/repo
sudo python3 scripts/web/configure-mainnet-preview.py --origin https://mainnet.nostos.iyforge.xyz
```

It compares observer/node heights and hashes, requires mainnet, reads existing
mail settings privately, and reports only readiness booleans, heights and the
proposed public origin. No wallet key, cookie, provider URL or email key is
printed. On a chain mismatch it creates no settings. Node movement may require
repeating the read-only check. It does not send email.

Only after `eligible: true`, the explicit operator `--apply` option creates new
protected `mainnet.env` and `observer-rpc/.cookie` files. The cookie is a snapshot
of the current observer RPC authentication credential, readable by the web UID
through a read-only mount. The observer wallet directory, age identity and
wallet database are not mounted into the web container. No signer cookie or
operator wallet is configured. Existing mail sender/API settings are reused;
merchant accounts, payments and encryption keys are not copied from testnet.
The initializer refuses to overwrite existing settings.

The observer creates a new authentication cookie each time it starts. A snapshot
from before an observer restart becomes stale. Refresh that snapshot privately
before reconnecting, with the mainnet application held; do not change directory
permissions or mount the complete observer wallet to bypass the credential
boundary. Automatic snapshot refresh and persistent observer service setup remain
operational follow-ups.

The existing isolated mainnet deployer then uses the preview mode and cookie-only
mounts, separate data/key/runtime/release directories, and ports 3100/3101. This
source change neither deploys that application nor provisions DNS/nginx/TLS.
Registration, HTTPS, real UFVK import and subsequent merchant sync/signing must
still be demonstrated.
