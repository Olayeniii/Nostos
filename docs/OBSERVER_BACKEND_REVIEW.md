# Observer backend review, 20 October 2026

This review follows recovery of the operator's original resource screenshot:
Zcash developer docs, ZIPs, librustzcash, Zebra, ZODL and NEAR Intents. That list
does not prescribe Zallet, Zaino, a custom relay or self-hosting a node.

## Current failure and evidence limit

The last fatal log supplied by the operator is a recover-history sync exit at
20:38:08 UTC after RPC error -32000, `Chain RPC unavailable.` That generic error
originates in our relay and hides the method and underlying failure. Source fixes
to time limits and RPC envelopes do not prove compatibility under sustained sync.
The newer fixed-category diagnostic has been installed, but the latest supplied
startup output has no ready indexer, no cookie, no indexed height and no diagnostic
failure. It therefore does not identify the remaining cause. Do not infer an
outage, provider quota, corrupted wallet or successful sync from these records.

The supported RPC requirements must be checked across startup, subtree recovery,
full/compact block retrieval and transaction enhancement. A passing tip read or
metadata preflight covers only a subset of that path.

## Source comparison

| Option                           | Source findings                                                                                                                                                                                                                    | Decision                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing Zallet/Zaino observer   | Patched view-only import exists and ARM build passed. Pinned Zallet has only Zebra and Zaino backends. Current mainnet runtime is not ready.                                                                                       | Preserve the installation and evidence. Do not call it working or keep changing policy without a specific failure.                                                             |
| Zingo CLI / zingolib             | CLI documents UFVK watch-only creation and separate network directories. Key code handles Orchard/Ironwood receivers. Current development CLI bundles a Nym transport and has a broader lifecycle than a headless NOSTOS observer. | Technically relevant, but not a verified drop-in replacement or simply another endpoint URL.                                                                                   |
| ZecLedger                        | Source calls SDK `import_account_ufvk` with `AccountPurpose::ViewOnly`, then standard `sync::run` against hosted lightwalletd. History exposes transaction balance changes and concatenated received memos.                        | Confirms a simpler SDK sync approach exists. Its displayed history is insufficient for exact per-output refund verification; do not substitute it for NOSTOS's matching rules. |
| Direct librustzcash light client | SDK provides lightwalletd gRPC bindings, Ironwood-aware tree/compact-block types, account import and transaction decryption APIs.                                                                                                  | Run a separate compatibility probe before committing to an adapter or changing the VPS.                                                                                        |

ZecLedger's README contains conflicting statements about whether the viewing key
is stored. The account/database code stores it in the wallet database and applies
SQLCipher to connections. Source, not the contradictory prose, governs any reuse.
No ZecLedger code is copied into this probe.

## Concrete isolated test

`scripts/lightclient/probe.rs` is compiled as an example against the same pinned
Zallet core and librustzcash dependency graph already used in the project. It does
not run Zallet, Zaino or the relay. The workflow makes public-chain reads against
two HTTPS endpoints present in ZODL Android's source: zec.rocks and
eu.zec.stardust.rest. TLS verification stays enabled.

The checks cover mainnet identity, a stable mined anchor, actual SDK decoding of
the Ironwood tree into an account birthday, compact-block decoding and agreement
between the tree state's hash and the compact block. A separate unit test uses
public deterministic test material for full/wrong-network/incoming-key decoding.
No real viewing key is supplied. No wallet database, production account, send,
service change or VPS download is included.

A pass establishes only endpoint and SDK decoding compatibility. It does not
prove a merchant import, durable wallet sync, memo intake, outgoing receiver/amount
verification or funded payment/refund. Those remain required before mainnet use.
The workflow is not a decision to replace the existing deployment.

## Verified probe result

GitHub run [39516665072](https://github.com/Olayeniii/Nostos/actions/runs/39516665072)
passed on 20 October at 23:43 UTC, using source commit
`181ee753940be84432825c3be29d253e0017ada1`. Both reference-wallet endpoints
reported mainnet height 3,524,921 and agreed on the mined anchor at 3,524,919.
TLS verification, actual SDK account-birthday tree decoding, compact-block hash
agreement and Ironwood metadata checks all passed. The deterministic viewing-key
decoding test also passed. Normal application CI
[39516665071](https://github.com/Olayeniii/Nostos/actions/runs/39516665071) passed.

The first probe failed before any endpoint call because Rustls had no selected
crypto provider. The isolated preparation script now explicitly enables the
already-pinned ring provider, while asserting unchanged dependency versions,
sources and checksums. This is a probe setup fix, not evidence about the VPS fault.

The next implementation target is an isolated view-only SDK observer adapter:
import a merchant-authorized full viewing key, persist and resume sync, expose
exact received outputs and memos, and verify exact outgoing receiver/amount/pool
against the authorized instruction. Prove those with fixtures before connecting
real merchant view access. Preserve the existing Zallet installation for comparison
and rollback; no backend switch or VPS service action has occurred.

No wallet was created, no real key was imported and no send was requested by this
probe. Merchant sync, transaction decryption and a mainnet payment/refund remain
unverified. Public hosted services learn the client's network address and queried
chain ranges; using TLS is not a privacy certification.

## View-only sync foundation, verified 21 October

The CI-only observer foundation passed in
[run 39518585162](https://github.com/Olayeniii/Nostos/actions/runs/39518585162)
at 00:03 UTC on 21 October, source
`bea4507ce8fa2ad56838bc18d4aa5246971bd55a`.
A temporary public-test account synced to height 3,524,931 and reopened the same
SQLite scan checkpoint. Same-key import remained idempotent; a changed key or
birthday was rejected. Four cache/policy tests and the viewing-key decoding test
passed. Application CI
[39518584873](https://github.com/Olayeniii/Nostos/actions/runs/39518584873) passed.

The foundation rejects transparent view access. The fixture creates an
Orchard-only UFVK from public test material; it does not change a merchant key.
Its gRPC interceptor permits only `GetLightdInfo`, `GetTreeState`, `GetLatestBlock`,
`GetBlockRange` and `GetSubtreeRoots`. Other methods, including transparent address
queries and sends, are denied before transport. Transient server errors have at
most three attempts; storage, scan and unknown errors stop with fixed categories.

This proves temporary view-only scan persistence, not production durability,
mid-write crash recovery, reorg recovery, merchant sync or memo/refund matching.
The fixture accepts no real key or persistent wallet path, exposes no service and
is not connected to the app. No VPS command, production wallet import or send was
requested. See `scripts/lightclient/README.md` for the remaining gates, especially
full-transaction enhancement, exact output matching and protected storage.

## Transaction and storage stage, verified 21 October

[Run 39521214074](https://github.com/Olayeniii/Nostos/actions/runs/39521214074)
passed at 00:27 UTC on 21 October with source
`076955b68a5a06e436d7cdce075d30e0529175e7`. Thirteen observer tests plus the
viewing-key test passed. The public-key fixture scanned through height 3,524,956,
reopened protected storage and fetched/decoded a public full transaction whose
block matched the stored chain anchor. Both metadata providers passed.

New source handles the SDK enhancement queue and exact incoming/outgoing output
matching. Actual SDK decryption of encrypted Orchard and Ironwood notes is covered
by offline fixtures; their proof/signature placeholders are invalid and they are
not funded or broadcastable transactions. Changed receiver, amount, memo, pool,
direction or account, insufficient confirmations, missing outgoing viewing data
and ambiguous matching outputs are rejected. Real merchant enhancement storage
and an authenticated application service connection remain unverified.

The isolated storage guard enforces private directory/file permissions, a writer
lock and rejection of symlinks, hard links, exposed WAL and unexpected files.
Actual WAL/SHM permissions were tested while SQLite was running. This does not
prove VPS logs, live WAL contents, encrypted backups, crash recovery or reorg
recovery. The SDK database remains plaintext behind filesystem permissions.

`GetTransaction` and `GetBlock` are now allowed public read methods. Fetching full
transactions reveals queried txids to the hosted service. Block membership is
checked against the SDK's observed chain; this is not independent full-node
consensus validation. See `scripts/lightclient/README.md` for current gates.
No service was installed or started, no real key was imported and no send was
requested by this work. Existing production/refund state is untouched by this code.

## Authenticated service connection, verified 21 October

SDK [run 39648793461](https://github.com/Olayeniii/Nostos/actions/runs/39648793461)
passed at 18:02 UTC using `ea8b63518c52efcbe8b2e3b2be367db225858fe8`.
The public fixture scanned through 3,525,789. Tests crossed the actual authenticated
HTTP broker and native pipe worker, checked idempotent import, rejected birthday
changes and kept merchant databases separate. The web adapter is opt-in and
requires new explicit scope consent; existing Zallet claims are not converted.
Normal application CI also passed. HTTP policy tests block sends and internal
sync requests before worker dispatch.

This closes the isolated service-connection gate, not live merchant verification.
Payments remain held. No service was installed or restarted, no real merchant key
was imported, and no mainnet payment/refund was made. See the lightclient README
for the deployment, recovery, encrypted backup and live privacy gates.

## Recovery fixtures, verified 21 October

[Run 39650001104](https://github.com/Olayeniii/Nostos/actions/runs/39650001104)
passed at 18:12 UTC, source `7ae86f1add917f8df35aeb76a2a591ff313a84bf`.
Child processes exited without destructors inside an uncommitted SDK import and
after a committed import with WAL present. Reopening checked the expected account
count, SQLite integrity and writer-lock reacquisition. The public-chain fixture
also rewound its persisted scan and recovered through height 3,525,796.

These tests use fresh temporary directories and public deterministic material.
They do not establish recovery of real merchant enhancements, competing-chain
forks, encrypted backups or live VPS storage. A separate follow-up fixes background
sync resumption after a stored account reopens; its regression test requires no
reimported viewing key and keeps status locked while sync is busy. That follow-up,
`be34a2a71c03d667db50459db9ce0703f9e7b9be`, passed SDK
[run 39650381264](https://github.com/Olayeniii/Nostos/actions/runs/39650381264)
at 18:14 UTC and application CI
[39650380790](https://github.com/Olayeniii/Nostos/actions/runs/39650380790).
The final public fixture reached 3,525,799; mainnet merchant and payment proof
remain explicitly false.

## Merchant signing remains separate

ZODL Android's source changelog records full/incoming viewing-key export and
ZIP-321 support. This does not establish a general application signing API.
The initial merchant flow remains explicit review and approval in the signing
wallet, followed by independent confirmation of the exact receiver, amount, pool
and instruction. No automatic-send claim or operator-signer fallback is allowed.

## Inspected primary sources

- <https://zcash.readthedocs.io/en/latest/rtd_pages/lightclient_support.html>
- <https://zcash.github.io/librustzcash/rustdoc/latest/zcash_client_backend/index.html>
- <https://github.com/zcash/zallet/tree/987382f67e622915228686e9f956c6a9c9a7514c/backends>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_backend/src/proto/service.rs>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_backend/src/proto/compact_formats.rs>
- <https://github.com/zingolabs/zingolib/blob/d4ac5772d7fc5d4ca621e57523d28f1b24ac24c5/zingo-cli/README.md>
- <https://github.com/zingolabs/zingolib/blob/d4ac5772d7fc5d4ca621e57523d28f1b24ac24c5/zingolib/src/wallet/keys.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/account.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/history.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/db.rs>
- <https://github.com/zodl-inc/zodl-android/blob/4bef0f470eee7e2df3018fc7158099da17c7c29b/CHANGELOG.md>
- <https://github.com/zodl-inc/zodl-android/blob/4bef0f470eee7e2df3018fc7158099da17c7c29b/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/provider/LightWalletEndpointProvider.kt>
