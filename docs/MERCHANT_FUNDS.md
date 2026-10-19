# Merchant funds and mainnet candidate

This candidate adds merchant withdrawal of released earnings to an Orchard-only
shielded destination. The existing hosted merchant Zallet remains the spending
custodian. No swap, bank cash-out or merchant self-custody is claimed. Code and
fixture results are not evidence of a live withdrawal or mainnet transaction.

## Balance and reserve policy

A confirmed payment's remaining principal stays reserved through its original
refund window, any requested/approved customer refund, and any unresolved refund
instruction. Confirmed refunds reduce remaining principal; failed instructions do
not count as paid. A missing route does not release a still-open obligation.
Item21 keeps its unset deadline, retained routes and remaining 200000 zat liability.
Its successful reconciliation changed no entitlement and supplied no wallet funds.

Available earnings are the lesser of wallet funds after refund reserves/fee
allowances and released, recorded sale principal after recorded withdrawal amounts
and fees. This intentionally excludes automatic withdrawal of external top-ups and
unindexed payments. Unconfirmed payments do not create released earnings. Any
active refund/withdrawal instruction blocks a new withdrawal. Operator spends
outside NOSTOS are outside this accounting boundary; use dedicated accounts and
reconcile them before enabling merchant withdrawals.

The default fee allowance is 10000 zat per open payment. It is a configurable
buffer, not an exact future refund fee quote or a guarantee that every fragmented
wallet can refund in full. A short balance is displayed as funding needed, not a
reduced refund entitlement. The merchant must fund fees separately. No small
reserve can honestly promise full refunds on a larger outstanding obligation.

## Withdrawal authorization and transaction flow

Verified merchant session, exact trusted origin and current password are required
for review and confirmation. The server fixes the merchant/account, network,
amount, shielded destination and actual proposed fee in a two-minute review.
Private destination and unsigned PCZT are encrypted with the product key; neither
PCZT nor raw signed bytes are returned to the browser or written to logs.

Zallet beta.3 `pczt_create` selects Orchard-family funds with FullPrivacy, then
`pczt_inspect` reports the proposal fee. This implementation accepts no transparent
or Sapling inputs/outputs, requires the exact destination/amount, and checks that
the proposal fits released earnings plus its fee. Inspection describes the trusted
wallet's own proposal; it is not standalone cryptographic proof. The saved unsigned
PCZT remains within the hosted wallet/operator trust boundary.

Confirmation rechecks full node/wallet sync and chain hash, the reviewed proposal,
expiry, current balance, liabilities and absence of competing spends. A SQLite
writer lock shared with refund reservation atomically claims the withdrawal.
Only then does the server prove, inspect again, sign and extract that same PCZT.
Extraction verifies proofs/signatures and must report that the wallet stored it.
The exact txid is saved before broadcasting through the separately configured
loopback full node RPC. Signed bytes remain in memory. No send is executed by
review, funds polling or deployment.

Replaying a recorded broadcast/confirmed instruction returns its saved result. A
send error, timeout or crash after claim stays blocking. There is no automatic
retry or timed clearance. A recorded txid can be confirmed only with the exact
outgoing amount, matching Orchard receiver and shielded pool from wallet history.
Null-txid outcomes need independent operator evidence and a separately reviewed
recovery, not a new withdrawal. The original Item21 key remains permanently dead.

Withdrawal history retains encrypted destinations and amount/fee/txid accounting.
Unsigned review PCZTs are cleared when superseded or after extraction. Full wallet
history, logs, WAL/SHM and backup retention still require the live privacy review.

## Existing testnet deployment

The current isolated auto-deployer remains testnet-only and does not start or
restart wallets or Zebra. Configure existing node access privately first:

```bash
cd ~/nostos/repo
git pull --ff-only origin main
sudo python3 scripts/web/configure-funds.py
sudo python3 scripts/web/deploy.py
```

Wait for any active auto-deployment to finish before invoking the manual helper.
It shares the deployment lock and leaves the live container running while building.
Starting the auto-deploy service alone does not reload settings for a revision
already marked healthy; the explicit deployment above incorporates the new file.

The configuration tool asks for the actual loopback node RPC URL, its cookie path
inside the container and the fee allowance. It writes root-only `funds.env` outside
Git. It does not copy cookies, add mounts or change services. Use an existing
read-only mount readable by the web UID. Do not post raw environment, config or
cookie contents in chat. The deployer incorporates the file into its usual checked
release. If an already-held revision needs retry, inspect the failure first and
use the existing isolated manual deploy helper; do not reset local work.

Open `/merchant/funds` after the healthy release. Missing node configuration,
network mismatch or incomplete wallet sync disables funds operations. Review the
existing Item21 values without sending another payment, refund or withdrawal.
No live spend is authorized by these setup commands.

## Mainnet isolation and deployment

Mainnet is an explicitly enabled, separate deployment. It has its own hostname,
wallet/node RPCs, RPC cookie mounts, encryption key, application databases, release
root, lock, preview port, web container and rollback containers. Existing stores
are testnet; neither application nor ledger can be adopted/relabelled as mainnet.
Network labels are fetched at runtime so a testnet-built bundle cannot silently
label a mainnet runtime as testnet. Mainnet refuses missing isolated configuration
rather than falling back to testnet values. Receiver decoding and node chain
identity plus matching fully synced wallet/node hashes guard spends. Payment
memos and Orchard-only refund policy are unchanged. Mainnet automatic Noir payment
completion is not verified; manual wallet entry is still the proved interaction.

Use the [hosted mainnet connection](HOSTED_MAINNET.md) as the preferred setup: a
hosted Zebra endpoint supplies chain data, while a separate local Zallet keeps
signing keys. A self-hosted mainnet node is optional. First verify the hosted RPC
methods and provision a separate mainnet merchant wallet using the upstream
wallet instructions.
Do not convert, restart or repoint the current testnet services. Node/wallet sync,
RPC access and the required PCZT methods must be checked independently. This
repository's deployer intentionally does not provision wallet seeds or chain data.
Do not fund an unverified setup.

Prepare `/home/ubuntu/nostos/mainnet/mainnet.env` privately, root-owned mode 600.
It uses literal KEY=value lines, no shell interpolation. Required entries:

```text
NOSTOS_MAINNET_ENABLED=yes
NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL=<separate loopback mainnet wallet URL>
NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE=/wallet/merchant/.cookie
NOSTOS_MAINNET_CHAIN_RPC_URL=<separate loopback mainnet full node URL>
NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE=/wallet/node/.cookie
NOSTOS_WEB_TRUSTED_ORIGINS=https://<separate mainnet hostname>
NOSTOS_EMAIL_FROM=<verified sender>
NOSTOS_EMAIL_API_KEY=<private sending credential>
```

Existing mainnet RPC cookies must be made available by the operator at
`mainnet/wallet-rpc/.cookie` and `mainnet/node-rpc/.cookie`, without exposing seeds
or spending keys. They are mounted read-only. Set permissions for the existing
numeric web UID without making credentials world-readable. Never substitute the
testnet cookie directories. No keys or cookies belong in Git or the build image.
Do not provide product database/key entries: the deployer creates a separate
`mainnet/product-data.key` and `mainnet/product-data` bind.

After validating the separate infrastructure and HTTPS proxy, run explicitly:

```bash
sudo python3 scripts/web/deploy-mainnet.py
```

The first run creates a stopped mainnet web template from only the current Node
image and numeric user, with mainnet env/mounts. It never copies testnet env or
wallet mounts. It then builds a checked isolated release, previews on loopback
3101 and switches only `nostos-mainnet-web` on loopback 3100. Existing mainnet
releases retain normal failed-switch rollback; a failed first deployment leaves
the initial template stopped. Testnet stays on 3000/3001 and its existing timer.
Proxy the separate HTTPS hostname to 127.0.0.1:3100 with its own certificate;
never route it to testnet or publish RPC ports. There is no automatic mainnet timer.
Changed mainnet runtime settings require private operator reconciliation rather
than silently reusing a different configuration. Deploying does not send ZEC.

Do not downgrade to a release without withdrawal-aware spend guards while a
withdrawal exists in progress. Preserve the additive ledger and original database;
never restore a snapshot to clear a send. Reconcile first and use a compatible
release for rollback/continued merchant operation.

## Evidence still required

- Existing testnet Funds page, configured node access, balance/reserve and review
  rendering, without submitting a new spend.
- Separate mainnet node/wallet sync, network/cookie isolation and supported RPCs.
- A separately authorized small mainnet payment/refund/withdrawal proof, with fees
  funded in addition to the customer amounts. Never call testnet funds mainnet.
- Application/proxy/wallet logs, wallet memo storage, WAL/SHM and backups.
- Final redacted demo and submission receipt.

Source interface review: Zallet `v0.1.0-beta.3`, methods `pczt_create`,
`pczt_inspect`, `pczt_prove`, `pczt_sign`, `pczt_extract`, and `getwalletstatus` in
<https://github.com/zcash/zallet/tree/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods>.
