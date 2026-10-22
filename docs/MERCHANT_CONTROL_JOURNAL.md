# Merchant control-transfer journal preparation

This is an isolated source/test checkpoint, not a live control tool or a signing
integration. It is prepared on `fix/dependency-security-oct22` after the
operator-reported offline binding pass recorded at
`617e89c5ab3713cf2d1f2d914c00bd2d08ea3d8e`.

## Implemented boundary

`scripts/merchant-control/journal.ts` accepts an injected, dedicated SQLite
connection. It rejects an existing product/wallet database and partial or
differently bound journals. It neither opens a filesystem path nor connects to
the observer, Android, network, signing service or product application. Only
tests instantiate it at this checkpoint. It reuses the NOSTOS refund state
vocabulary without creating fake payments in the merchant ledger.

The instruction snapshot records a caller-asserted approval reference/time,
mainnet, exact pool, opaque account/receiver/memo commitments and fixed test
limits: 10,000 zatoshis to the recipient, fee no greater than 10,000, debit no
greater than 20,000, and at least three confirmations. Lower fee/debit limits and
higher confirmation requirements are enforced when selected. This stores an
approval assertion; it does not authenticate an operator or grant permission.

Instruction replay is idempotent only for identical immutable fields. The same
merchant, account commitment or approval reference cannot obtain a second
instruction in that journal. SQL transactions serialize independent writers.
`reserveExternalSend` makes the durable transition before any future manual
handoff; it does not send anything. After that transition there is no API to
reset, release or make a replacement send. A crash leaves an unresolved
`broadcasting` state; it never restores permission to send. A known txid cannot
be replaced, and a timeout after recording one cannot erase it.

Candidate observations must match the saved chain, pool, account, receiver,
amount, memo commitments and budget. They are deduplicated by instruction and
the chain/txid/pool/output-index tuple. Conflicting block or transaction claims
are held for investigation, preserving the reservation. Exact repeated evidence
is idempotent; changing confirmation counts or other evidence fields is not
automatically accepted at this stage. Reorgs therefore require a future explicit
revalidation step, not a replacement payment or a new receipt.

## Evidence and privacy limits

Caller-supplied observations are **unverified candidates**. Even a complete
candidate leaves `confirmed`, `liveEvidenceVerified` and
`compatibilityGatePassed` false. There is no confirmed state or settlement API.
Synthetic fixtures cannot become live proof by setting a boolean. Receipts
contain only state and fixed/derived booleans, without txids, addresses, memos or
account commitments. Errors use one fixed message, including on SQL failures.

The accepted schema has no raw memo, address, viewing key, seed, spending key or
raw transaction fields. Extra fields are rejected before insertion. Opaque
commitments must eventually be computed by a trusted private validator using a
stable, domain-separated keyed commitment. They are not plain memo hashes and
are not accepted as a cryptographic validation result. That validator and its
key management are not implemented here. No live data was used in these tests.

The injected database connection does not establish protected storage or encrypt
transaction metadata. A future operator runner must enforce private storage,
ownership, no symlinks/hardlinks, writer isolation, backups, output suppression
and the approved host/resource limits before any live use. The journal is not
wired into a web route, worker method, operator command or production database.

## Tests

Eleven targeted tests cover instruction immutability, restart durability,
independent-connection duplicate reservations, uncertain broadcast, immutable
txid association, duplicate observations, mismatched chain/pool/account/receiver/
amount/memo, approval budgets, changed block evidence, privacy boundaries and
refusal to adopt an existing application or incorrectly bound database.

Local `pnpm check` passed: formatting, lint, type checking, 338 tests (including
these eleven), TypeScript build and the secret scan. These results concern
source/test fixtures only; no live transaction behavior was tested.

All files/databases/values are temporary invented fixtures. There is no valid
shielded transaction, live UFVK, Android signing, provider RPC or real receipt.

## Remaining before requesting funds

1. Finish the private SDK adapter: validate canonical receiver and sender
   binding, prove the recipient is a different controlled account, construct
   keyed commitments and keep exact padded memo bytes private.
2. Validate mainnet activation, consensus branch, full transaction identity,
   anchored block membership, pool, confirmations and exact outgoing recovery.
   Verify a spent note belongs to the business account, determine actual fee and
   reject transparent inputs/outputs. Recipient-side recovery is insufficient.
3. Bind verified evidence to the immutable approved attempt, persist its private
   references and repeat validation after reopening. Design explicit reorg and
   changed-tip handling before adding any verified/confirmed transition.
4. Build/test the private operator runner with fixed sanitized output and
   protected storage. Prove actual host/service/port/volume isolation before
   proposing a live key import or funded send.
5. Request separate approval for the exact host, UFVK import/birthday/provider,
   sender/recipient, transaction plan, memo and spending/fee caps. Do not request
   a transfer while these implementation blockers remain.

The Android build/distribution, native business account selection and successful
artifact checksum confirmation still need explicit operator reporting. No repeat
key entry is needed. The web-image probe approval also remains pending; this
source checkpoint does not approve that separate VPS operation.
