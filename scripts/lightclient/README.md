# Isolated light-client observer work

## Private control harness candidate

The wallet compatibility branch adds `control.py` and the pipe-only
`nostos_control` method. See [CONTROL_TEST.md](CONTROL_TEST.md) for its fixed
limits, private ledger, exact outgoing/owned-spend checks, normal observer reopen
check and remaining live gates. The HTTP broker cannot call this method. No
product settlement or mainnet payment enablement is included. Build artifacts
and offline tests do not establish a funded merchant-wallet proof.

This is tested observer source, not a deployed service. An opt-in authenticated
preview listener and app adapter exist; no real merchant key has been supplied by
this work. There is no signing or send interface. No VPS configuration change is
included.

## Verified capabilities

- `probe.rs` checks public mainnet metadata and SDK decoding against two hosted
  reference-wallet endpoints, with TLS verification.
- `observer.rs` imports Orchard-family view access and scans into SQLite. Same-key
  import is idempotent; changed key or birthday and transparent view access fail.
- `transactions.rs` retrieves full transactions requested by the wallet, checks
  exact txid, complete byte consumption, mined height, consensus branch and
  inclusion in a compact block matching the wallet's stored block hash. Unmined,
  unavailable or conflicting results stay unresolved. Queue processing is bounded
  to 32 requests per call. No refund state or reservation is modified.
- Exact matching requires the observed account, canonical mainnet Orchard-only
  receiver, amount, expected memo bytes, pool, direction and minimum confirmations.
  Change, missing outgoing viewing data and duplicate matching outputs cannot
  confirm a refund. Orchard and Ironwood remain distinct pools.
- `storage.rs` requires a private, canonically addressed directory owned by the
  process user, safe ancestors and private regular files with one hard link.
  SQLite files are pre-created with mode 0600. An exclusive writer lock, no-follow
  file opens and pre/post-open checks protect this isolated storage root. Extra
  files, including stray logs or backup copies, are rejected. Audits after writes
  also cover database, WAL, SHM and journal files.

The workflow passed in run
[39521214074](https://github.com/Olayeniii/Nostos/actions/runs/39521214074), source
`076955b68a5a06e436d7cdce075d30e0529175e7`, on 21 October 2026.
Thirteen observer tests plus the viewing-key test passed. Both hosted metadata
probes passed. The live public-key fixture synced through height 3,524,956,
reopened its checkpoint, audited protected storage and retrieved/decoded a public
full transaction anchored to its scanned block. It had no merchant transactions
to enhance; it does not test persistence of a real merchant's decrypted outputs.

## What the encrypted fixtures prove

`transaction_tests.rs` builds real encrypted Orchard V2 and Ironwood V3 notes,
serializes and parses their containing transactions, and uses the SDK to decrypt
incoming and outgoing fields. Tests reject changed output fields, insufficient
confirmations, missing outgoing viewing data and duplicate matching outputs.

Their proof and signature bytes are deliberately invalid placeholders. They are
non-broadcastable offline fixtures, not consensus-valid funded payment/refund
transactions. They do not establish main-chain inclusion or control of a refund
receiver. The mocked confirmed context is accessible only inside the test module.

Storage tests verify writer exclusion/release, rejection of exposed directories,
symlinks, hard links and exposed WAL files. Another test puts SQLite in WAL mode,
imports a public fixture through the SDK and checks actual WAL/SHM mode 0600.
The live fixture uses temporary files; none are uploaded as artifacts or cached.

## Transport and privacy limits

The transport permits only `GetLightdInfo`, `GetTreeState`, `GetLatestBlock`,
`GetBlockRange`, `GetSubtreeRoots`, `GetTransaction` and `GetBlock`. Other methods,
including transparent-address queries and sends, are denied before transport.
The fixture scopes public test material to Orchard-only view access. The adapter
must apply explicit consent and scope rules before accepting real full keys.

Full-transaction requests reveal queried txids to the hosted service, in addition
to the client's network address and chain ranges. Shielded fields are decrypted
locally. The block context is checked against the SDK's observed chain, which
still relies on the hosted chain service; this is not full-node consensus
validation or a privacy certification. The SDK wallet database contains viewing
keys, decrypted transaction data and history in plaintext behind file permissions.
It is not encrypted at rest by this guard.

## Authenticated app connection, verified 21 October

Source `ea8b63518c52efcbe8b2e3b2be367db225858fe8` passed SDK
[run 39648793461](https://github.com/Olayeniii/Nostos/actions/runs/39648793461)
and application [run 39648793755](https://github.com/Olayeniii/Nostos/actions/runs/39648793755).
The public fixture scanned through height 3,525,789. Its authenticated HTTP broker
called the compiled native worker through private pipes, imported the same scoped
key idempotently, rejected a changed birthday and kept a second merchant's database
separate. HTTP tests reject missing credentials, browser-origin requests, invalid
merchant identifiers, extra arguments, oversized bodies and send methods.

The web adapter requires an authenticated merchant, explicit scope consent and a
new `sdk-orchard-view-access-v1` claim. It does not convert an existing Zallet claim
automatically. Before native import, the worker extracts only the Orchard viewing
component. The original encrypted web claim remains subject to the existing
retention policy; scoping the worker does not remove that web record.

The service accepts only status, view-key import and Orchard receiver decoding.
Merchant UUIDs select separate private roots and workers; they are supplied by the
server-side app session. Only the broker can request a sync. An in-progress import
is not cancelled when the browser request times out. Busy status is locked and
payments stay disabled. Workers have no signing or send interface.

This is opt-in source, not an installed VPS backend. `run-service.mjs` requires a
private mode-0600 configuration with absolute `root` and `binary`, a verified
`binarySha256` and a loopback `port`. It validates file ownership, paths and modes,
creates a private service cookie and binds only to loopback. Do not run it against
existing Zallet storage. Configuration of the web adapter requires
`NOSTOS_OBSERVER_BACKEND=sdk-preview`, mainnet, `NOSTOS_WALLET_MODE=observer-preview`, a separate
observer RPC URL and an app-readable private cookie. Do not broaden cookie
permissions to bridge service/container users. A deployment procedure must supply
a protected credential copy or mount. No production configuration was changed.

## Remaining gates before real merchant view access

1. Test actual changing-chain context and mid-enhancement interruption. Public
   fixture [run 39650001104](https://github.com/Olayeniii/Nostos/actions/runs/39650001104),
   source `7ae86f1add917f8df35aeb76a2a591ff313a84bf`, passed abrupt-exit
   recovery of committed and uncommitted SDK imports, SQLite integrity and writer
   lock reacquisition. It also rewound and rescanned persisted public-chain state
   at height 3,525,796. This is not a competing-chain fork or VPS recovery proof.
2. Finish mined merchant enhancement and changing-anchor evidence. The offline
   fixture now stores decrypted incoming memos and complete transactions in both
   pools, reopens them, then encrypts/restores and reopens them through the SDK.
   They remain unmined and cannot satisfy the confirmed-store guard. Construct
   expected fields from persisted checkout/refund instructions, never client
   match claims, and recheck current chain context before committing results.
3. Verify the encrypted backup on real isolated storage, including an independent
   offsite copy and recovery identity. `backup.py` and its tested procedure are
   described in [SDK_OBSERVER_BACKUPS.md](../../docs/SDK_OBSERVER_BACKUPS.md).
   Fixture recovery does not prove live VPS logs, WAL or backup hygiene.
4. Package the pinned worker for Ubuntu ARM64 and verify isolated installation,
   private app credentials, merchant-authorized sync and the separately authorized
   funded payment/refund evidence. Preserve current testnet services and rollback.

The `prepare.py` helper changes only the CI checkout's features/provider selection
and asserts unchanged dependency versions, sources and checksums. It does not
modify or install the VPS wallet binary.

## Ubuntu ARM64 package

`.github/workflows/sdk-observer-arm64.yml` builds the pinned native worker on
Ubuntu 24.04 ARM64 and runs the encrypted memo/restore tests on that platform.
The package includes only `nostos-sdk-worker`, `service.mjs`, `run-service.mjs`,
`backup.py` and provenance. Its outer SHA-256 and each fixed file's SHA-256 are
recorded; the ELF header must identify AArch64. No wallet file, credential,
configuration or recovery identity enters the artifact.

This workflow does not install anything or start a VPS service. A successful
build must be verified before an isolated deployment procedure selects a new
private root, credentials and port. Existing wallet files and services stay outside
that procedure. The native worker is not a Zallet/Zaino replacement executable;
do not overwrite the earlier `zallet-zaino` binary with it.

