# Isolated light-client observer work

This is tested observer source, not a deployed service. It has no real merchant
key intake, listener, signing operation, send operation or production wallet path.
The existing app and VPS continue to use their current configuration.

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

## Remaining gates before real merchant view access

1. Add a service and authenticated app adapter. Map the existing merchant identity,
   encrypted key claim and consent to the SDK account. Construct expected fields
   from persisted checkout/refund instructions, never client-supplied match claims.
   Recheck current chain context before committing a payment/refund result.
2. Prove interruption and reorg handling. Checkpoint reopening after a completed
   scan is not a mid-write crash or reorg test. Exercise enhancement storage with
   detected encrypted transactions and changing block context.
3. Implement a consistent encrypted backup and recovery procedure, then inspect
   real VPS storage, logs, WAL and backups. No backup export exists here and no
   live backup check has been completed by the agent.
4. Complete merchant-authorized sync and separately authorized payment/refund
   evidence before mainnet use. Keep existing testnet data and services isolated.

The `prepare.py` helper changes only the CI checkout's features/provider selection
and asserts unchanged dependency versions, sources and checksums. It does not
modify or install the VPS wallet binary.
