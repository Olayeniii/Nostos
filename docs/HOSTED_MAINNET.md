# Mainnet through a hosted node

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
