# Private operator control tool

This is source and fixture preparation on `fix/dependency-security-oct22`,
following verifier checkpoint `3501d3ab371f31a2c2b8da95ff98e667ebf7ad44`.
No live key import, mainnet sync, funded transaction, service change or deployment
has been performed with this tool. Do not run the live modes until separately
approved. Signing remains in the merchant's Android business wallet.

## Implemented flow

The separate `merchant-control-X64` / `merchant-control-ARM64` CI artifacts contain
a native `nostos-control-check`, compiled journal/verification JavaScript, Node
runtime guard, terminal wrapper, module metadata and public provenance. The
fixed-file packager never enumerates or includes wallet state. Native tests run
the test harness, not the helper's mainnet network entry point.

The wrapper checks the independently reviewed provenance SHA-256 and each exact
file hash before accepting a key. It requires a private package directory, safe
ancestors, owned regular files, an executable helper, a real terminal and Node
24.22.1 or a newer Node 24 patch. Old Node and a missing/excessive cgroup memory
or CPU limit are refused before private prompts.
Keys, addresses and transaction IDs use hidden prompts and private stdin pipes,
never arguments or environment variables. Child stderr is discarded and output
is reduced to a strict fixed boolean schema. Core dumps are disabled. Timeout
or interruption kills only the new operator process group, not existing services.

All modes lock a separate private profile. The profile has a mode-0600 master
key, authenticated AES-256-GCM encrypted attempt file, private SQLite control
journal and a separate protected SDK wallet directory. Routes/control references
are absent from the SQLite journal, which stores keyed commitments and private
transaction/block references instead. The account, receiver and padded-memo
commitments use domain-separated HMAC-SHA256. Encryption uses a separately
derived key. Profiles with unsafe ownership/modes, symlinks, hardlinks or
unrelated files are refused before data writes; permissions are not repaired.

| Mode      | Behavior                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare` | Privately bind both displayed receive addresses to their FULL mainnet viewing exports; retain only the business Orchard component in the isolated observer, derive the second account's canonical Orchard-only receiver, sync and save an encrypted draft. The recipient viewing export is checked in memory only. No transfer or send reservation occurs. |
| `handoff` | Require a separate funded-control approval reference and fresh funding preflight; save the immutable approved instruction and reserve one external send before displaying the local control receiver, neutral message and limits. A repeat handoff is refused. This mode does not sign or broadcast.                                                       |
| `verify`  | Bind the existing txid, invalidate old verification, fresh-sync and verify in one native process, save candidate evidence, close/reopen the journal, then fresh-sync and verify in a second newly opened native process before marking the private control receipt verified.                                                                               |
| `recheck` | Repeat both fresh verifier processes for the already bound transaction. No new keys or txid are entered. Failure clears verification and retains the transaction association/reservation.                                                                                                                                                                  |

Each helper response is MAC-authenticated using a new pipe-only session key and
is bound to the exact request digest, operation and random nonce. No proof object
can be issued by deserializing a stored JSON claim. The journal accepts only two
independently issued, one-use in-memory proof objects with matching immutable
output identity and nondecreasing confirmations/tip. Same-height tip changes or
different mined block identity fail closed. Reorg conflicts require review; they
never reset permission to send. The private receipt is historical at its stored
tip; a later current-chain claim requires another `recheck`.

The public observer HTTP/pipe allowlists are unchanged. No control method is
exposed to the merchant web interface. This journal is a wallet control record,
not a NOSTOS checkout/refund receipt or proof of overall mainnet readiness.

## Funding preflight and hard limits

Before the one-time handoff, a fresh synced SDK view must contain exactly one
business-owned unspent Ironwood note of **20,000 zatoshis**, mined at least three
blocks deep, with a known funding anchor. Any tracked unspent Orchard note holds
the handoff. The native verification later checks the actual spent note, exact
10,000-zat outgoing output, padded control memo, actual fee and gross owned input
value. It rejects transparent, Sprout, Sapling or separate Orchard bundles.

The observer does not have transparent/Sapling viewing access. The preflight
does not certify those balances are zero. A dedicated native software business
account with known funding history and operator confirmation of no other pools
or pending migration is required. If this cannot be established, stop before
funding or signing; do not broaden viewing scope or substitute a large input.

- One ordinary shielded control send: 10,000 zatoshis (0.00010000 ZEC).
- Fee cap: 10,000 zatoshis; gross consumed business-note cap: 20,000.
- At least three confirmations for funding and for the control transaction.
- Zero replacement transfers or extra sends without separate approval.
- If the business account is empty, one separately approved 20,000-zat shielded
  funding payment may precede the control. With its own 10,000-zat fee cap, fresh
  source debit is at most 30,000 zatoshis, and combined fees at most 20,000.

Fee quotes above the cap, missing messages, swaps, cross-pool migrations, any
transparent/TEX fallback, unexpected output or uncertain broadcast must stop the
signing procedure. An app timeout is not permission to send again. Use the
existing transaction ID from wallet history for verification.

## Proposed operator setup, not yet approved

Use the merchant's own Linux Mint laptop, never the VPS, CI, a remote support
session or the recovered testnet wallet directories. Proposed profile:
`$HOME/.local/share/nostos-control-20261022`, new and private, with no published
ports or daemon. Proposed budget: a user scope capped at 2 GiB and 50% CPU, one
operation at a time. The wrapper checks the actual Linux cgroup-v2 limits before
revealing a key; an unbounded or larger scope is refused. The helper
has a ten-minute per-process timeout; two verifications have a twenty-minute
outer budget. No service restart is part of this proposal.

Provider: `https://zec.rocks:443`, TLS read-only shielded RPC allowlist. Approve
the actual account birthday before import; it must precede the funding note.
Sync can disclose transaction-interest metadata to the provider; it does not
send the viewing key there. Confirm local encrypted storage and a private
backup/recovery plan for the whole profile before live access. Encryption of an
attempt file is not full-profile backup or protection against a compromised host.
This checkpoint tests reopening, not live offsite disaster recovery.

Separate approvals required:

1. Local runtime/artifact preparation and isolated resource/profile validation.
2. Business live UFVK import, the second account's memory-only UFVK check,
   birthday and provider sync. `prepare` spends nothing but is not an offline
   test and does create isolated viewing-wallet state.
3. The exact funding source/transaction if needed, then the exact control send,
   recipient, memo reference, fee and debit limits. Review the private handoff
   and Android proposal locally, with recording/casting/clipboard history off.
4. Production observer integration, mainnet deployment, any funded NOSTOS payment
   and refund, and a reviewed merge to main remain separate later gates.

The Android build/distribution, native software business-account selection and
original checksum `OK` results still need explicit reporting. Do not repeat the
successful offline binding key entry merely to supply this metadata.

## Private invocation after artifact and operation approval

The wrapper expects a mode, private package directory, private profile and the
**public provenance SHA-256 independently matched to the successful reviewed CI
packaging log**. No live command or artifact hash is approved in this document.
The current successful offline binding package remains a separate tool.

Only `handoff` deliberately shows its neutral control memo and control receiver
on the operator's private terminal for manual Android review. They are not
customer return routes. Do not record, screenshot or paste that screen into
chat. All other output shared with Work is the fixed boolean report. No seed or
spending key is requested by any mode.

Native consensus/decryption checks rely on the approved SDK/lightwalletd scanned
chain trust model; the helper is not an independent full-node consensus engine.
Fixture success cannot prove real signing, real outgoing recovery or a live
persistent receipt. Those require the separately approved run and saved private
transaction/block evidence.
