# Private SDK control verifier preparation

Branch: `fix/dependency-security-oct22`, continuing the control journal checkpoint
`8ae562fa48b2dc5ac2ab78803d465c6033e41a39`. No merge, deployment, live account
import or funded transaction is authorized by this source checkpoint.

## Implemented SDK checks

`ControlRequest` in `scripts/lightclient/transactions.rs` accepts a canonical
mainnet Orchard-only receiver and a 32-character lowercase hexadecimal control
reference. It constructs the exact padded `nostos:control:` memo internally.
The request fixes the amount at 10,000 zatoshis, requires Ironwood and at least
three confirmations, and rejects fee/debit limits above 10,000/20,000 zatoshis.
It does not accept an arbitrary refund-route memo. None of its private fields
implement Debug or serialization.

`VerifiedTransaction::verify_control` runs inside an SDK database transaction:

1. Recheck scanned tip, transaction mining height and anchored block against the
   scanned wallet. The transaction itself must already come from the full
   transaction enhancement path, which checks chain branch, txid and compact
   block membership. Raw parsing cannot create that context outside tests.
2. Require one bound viewing account, reject a destination in that account's
   external or internal scope, and recover exactly the requested external
   outgoing Ironwood receiver, 10,000-zat value and full padded memo.
3. Require the pinned mainnet Ironwood activation rules, and reject any
   transparent, Sprout, Sapling or separate Orchard bundle. Extra recovered
   nonzero outgoing outputs, ambiguous output matches and duplicate spend
   nullifiers are rejected.
4. Calculate the transaction fee from its actual bundle value balances rather
   than a UI estimate. Enforce the approved fee and amount-plus-fee bounds.
5. Match consumed Ironwood nullifiers against the SDK's account-linked
   `NullifierQuery::All` records. For those account-owned notes, read the stored
   values and funding heights through the SDK extension authorizer, which permits
   reads but prevents writes to wallet schema/data. Funding must be mined in a
   known earlier block. Missing/pruned/unanchored values fail closed.
6. Enforce a conservative **gross consumed business-note value** cap. The sum of
   business-owned inputs before subtracting change must fit the approved debit,
   and must cover the requested amount plus fee. An input above 20,000 zatoshis
   therefore fails even if the wallet would return most of it as change. This
   bounds business value at risk without assuming amount plus fee is the total
   account debit or that all encrypted outputs are visible.

The resulting opaque `ControlEvidence` has typed transaction/block/output,
fee and gross-input accessors, without keys, destinations or memos. Errors from
the database verification boundary collapse to the fixed `control_unresolved`
code. The lower-level field matcher cannot create this evidence token.

## Pinned source and assumptions

The existing Zallet source pin remains
`987382f67e622915228686e9f956c6a9c9a7514c`; its librustzcash dependency remains
`1f6bb2072e7fcb142b0d90ff7b267a8699a84818`. No dependencies or consensus
activation values are changed. The source specifies mainnet NU6.3/Ironwood at
height 3,428,143; actual observed mainnet activation and block context still need
verification in a later approved live run.

SDK public APIs provide account keys and nullifiers. The amount lookup uses a
narrow read-only query against that exact pinned SQLite schema. Schema changes,
missing note values or retained-history gaps must fail; do not infer a value or
relax ownership checks to continue. The approved birthday must precede the
funding notes, not merely the control send.

This relies on the selected lightwalletd/SDK scanned-chain trust model. It does
not independently run full-node consensus or re-prove shielded proofs. Unknown
action nullifiers are not claimed to be dummy spends or assigned an owner. The
gross-input bound applies to business notes known to the fully scanned account;
complete account history and a dedicated known funding history remain required.
The ordinary Android send and its reviewed plan are required; collaborative
transactions, migrations and swaps remain outside the procedure.

## Test boundary and remaining work

Four additional native tests exercise actual fixture ciphertext recovery,
memo/key/pool/receiver and fee mismatches, unknown note ownership/value, debit
bounds, invalid control requests, and refusal of unmined synthetic transactions
before and after reopening. All cryptographic fixtures have invalid proof and
signature placeholders. Positive field checks never claim a mined transaction;
the full verifier must continue to refuse those fixtures. Native x86_64 and
ARM64 compilation/tests are required before this checkpoint is accepted.

This is the verifier core, not an executable live operator tool. The broker's
public/pipe method allowlists are unchanged. There is no new HTTP route or live
control method, and the journal's receipt still cannot become confirmed.

Remaining before a live test proposal:

- Build the protected operator runner and stable keyed request commitments,
  privately bind the verifier output to the immutable approved journal attempt,
  and keep real transaction/block references in protected storage.
- Add explicit persistence/revalidation with fresh chain sync after reopening,
  including changed-tip and reorg handling. A database anchor check alone is not
  a new provider sync or a competing-chain test.
- Verify the dedicated account's funding notes fit the gross cap before signing.
  If they do not, stop and review a different funding plan or limit; do not split
  notes, migrate, raise limits or submit a replacement without approval.
- Test the pinned-schema owned-note lookup with genuinely scanned, mined control
  data in the separately approved run. The current synthetic tests cannot prove
  the successful mined path or real outgoing recovery.
- Obtain separate approval for the exact isolated host, live viewing-key import,
  birthday/provider, second controlled recipient and transfer limits. Keep the
  recovered testnet services/files/volumes outside the process.

Primary source inspected:

- [SDK account/nullifier APIs](https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_backend/src/data_api.rs)
- [SDK extension authorizer](https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_sqlite/src/lib.rs)
- [Pinned note and nullifier tables](https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_sqlite/src/wallet/orchard.rs)
- [Actual fee computation](https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_primitives/src/transaction/mod.rs)
- [Pinned consensus activation](https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/components/zcash_protocol/src/consensus.rs)
