# NOSTOS closeout, 19 October 2026

Feature freeze: fix only proof, merchant-use or submission blockers. Baseline main
checked at `beda707aee2f0894dc4a0c3889827cd005d9ee99`. The matching running release
was operator-reported on 14 October, not freshly inspected from this workspace.

## Current result: unknown instruction reconciled without another send

Operator apply output at 2026-10-19T11:15:50.498Z reports `applied=true`,
`status=failed`, 1800000 zat confirmed refunded, zero reserved and 200000 zat
available accounting value. Both protected routes remain; sends requested is zero
and the old instruction cannot be retried. The node and fully synced wallet were
at height 4484617, with only the two known account transactions. The wrapper passed
its matching deployed-revision guard for ddb9567. This is supplied operator evidence,
not direct agent VPS access. A repeat command was pasted without its result; repeat
idempotence is tested locally but has not yet been observed live.

The earlier 190000 zat balance is still historical. Releasing the reservation adds
no wallet funds; a new 200000 zat refund would need sufficient funds plus fees and
separate merchant authorization. Live logs/storage/WAL/backups, merchant withdrawal,
mainnet, final video and submission remain open.

## Historical unknown checkpoint before reconciliation

Item21 received 2000000 zat. Its earlier 1800000 zat refund is confirmed in supplied
operator evidence; the customer confirmed receipt in Noir. The later instruction
`refund_dbd484d2-f75c-43d8-a63f-5f3a6c3e0250` for 200000 zat was
`broadcast_unknown` with a null txid before reconciliation.
At that checkpoint its reservation and both encrypted routes were preserved,
and available value was zero. The current result above supersedes that state.

The earlier account balance was 190000 zat and its transaction list contained only
the payment and earlier refund. No log was captured for the attempt. These support
a funding rejection but do not prove non-broadcast. No database clearance, retry,
refund reduction, wallet resync, service restart or new payment is authorized by
these observations. A confirmed partial refund proves a payment/refund loop; it
does not prove that the entire original payment has been returned.

The current application catches any send exception as unknown. Its reconciliation
checks recorded broadcast txids only; it cannot resolve an unknown/null-txid record
by refreshing the receipt. Zallet documents `z_sendfromaccount` as synchronous,
returning a transaction ID. Do not substitute async operation polling as proof for
this call or invoke a method that consumes/removes operation results.

### Next operator evidence

Run from the existing VPS source checkout after obtaining this revision:

```bash
cd ~/nostos/repo
git pull --ff-only origin main
sudo python3 scripts/web/inspect-wallet-evidence.py
```

The script finds open SQLite files belonging to the running merchant wallet
service's MainPID. It reads transaction metadata and file permissions only. No
wallet/application store constructor, RPC, signing, migration, checkpoint, copy,
cleanup or service operation is used. It reports only counts, booleans and numeric
version/expiry metadata. Raw transactions, memos, destinations, accounts, database
paths, credentials and keys are not emitted. SQLite reader coordination can touch
SHM read marks. It is a read-only application-data check, not forensic media access.

It reports whether the two known transactions exist in the underlying wallet,
whether additional or unmined records exist, and whether those records carry expiry
heights. Other records may belong to other accounts and are not automatically this
refund. If records are found, the next dependent step is private correlation to
the exact account, route, integer amount and attempted time, followed by independent
chain/expiry evidence. Do not assign a transaction from an amount-only match.

If the DB is not open by MainPID, the schema differs or inspection fails, the
result is unavailable. If no extra record exists, the result is still not a proof
of non-broadcast, wallet sync completeness, database continuity or lack of an old
signed transaction. The installed wallet version/source, durable-before-broadcast
behavior and complete chain coverage must be established before clearing anything.
This script deliberately has no resolution or mutation command.

## Complete existing flow evidence

| Step             | Existing evidence                                                                         | Remaining limit                                                          |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Payment prepared | Expected NOSTOS memo/order and Orchard-only route matched in supplied wallet evidence     | No claim of payer ownership or control of the route                      |
| Payment received | 2000000 zat confirmed in lifecycle output, incoming Ironwood note                         | Supplied operator proof; public txid alone cannot reveal shielded amount |
| Merchant refund  | 1800000 zat confirmed with recorded txid and zero retries                                 | Partial refund, separate from the later unknown instruction              |
| Customer receipt | Customer confirmed funds received in Noir after sync                                      | Manual payment path; automatic payment failed consensus validation       |
| Receipt/UI       | Existing merchant and customer phone views showed readable amounts and wrapped references | Historical views; no new recording performed here                        |
| Final amount     | 200000 zat attempt reconciled as failed; zero reserved, routes retained                  | Available accounting value is not wallet funding; no full-refund claim   |

Preserve the existing transaction references and provenance in
`scripts/evidence/item21-refund.json`. Do not invent a fulfillment failure or claim
a customer request caused the historical refund. No new transaction is needed to
record the proven partial-refund loop. If full repayment is later requested, it
requires the unknown attempt to be resolved first and separate spending approval.

## Privacy checks and submission

The 14 October source review reported 124 ancestor commits and 418 text blobs
pattern-scanned, with three binary blobs excluded and no confirmed sensitive
matches. That is historical bounded evidence; the workspace containing its
unpushed patch was later removed by maintenance. This closeout document does not
claim those files were committed or that the scan was rerun today.

Live privacy remains open across application/proxy/wallet logs, wallet memo storage,
SQLite DB/WAL/SHM copies and backups. Current-column encryption already has scoped
operator proof. Wallet memo history is an intentional operator-visible retention
boundary. Logical route retirement does not erase it or old WAL/backup copies.
Collect safe counts and permissions, then review actual retention/access policy.
Do not dump raw logs, backups, configs or wallet rows into chat or the repository.
Do not vacuum/checkpoint/purge live data to manufacture a clean result. Existing
eligible expiry/full-refund records can supply live retirement evidence if any
exist; Item21 must retain both routes while its refund is unresolved.

After outcome and privacy evidence, record the existing merchant and receipt views,
redact private capabilities, routes, identities and memos, and finish submission
fields against the current signed-in organizer requirements. Do not mark submitted
without a saved receipt. Use the existing `docs/DEMO.md` and its evidence boundaries.

Public wording: refund route supplied with this payment; customers accountless;
hosted merchant Zallet custody; operator can read payment/refund details. Preserve
expected memo and Orchard-only refund policy with no transparent/TEX/Sapling
fallback. No claim of operator blindness, unlinkability, automatic Noir completion,
mainnet readiness or implementation of draft Authenticated Reply Addresses.

Progress board: https://iy-build-command-center.ifeola997.chatgpt.site. The source
baseline was updated on 19 October; browser overrides remain separate from it.

## Checks in this pass

The new metadata scanner is tested with temporary SQLite databases for known
transaction byte order, unmined candidates, unavailable schemas, missing-file
noncreation, malformed IDs, no raw-data output and unchanged DB content. These
tests are local fixtures and cannot establish the live wallet outcome. Full
application tests/builds and live inspection are separate evidence.

## Wallet database observation, 19 October

The operator supplied the new inspector result: Zallet 0.1.0-beta.3, one open
wallet database, ten transactions, both known transaction matches present, eight
other records and zero other unmined records. All ten have stored raw transaction
records. DB group/other permissions are absent; WAL and SHM files were absent in
that observation. This is all-account metadata, not proof that eight additional
refunds occurred, that unknown sends cannot exist, or that backups/logs are clean.

The next inspector revision identifies an account only if exactly one account was
credited by the known payment and debited by the confirmed refund. It reports that
account's transaction counts and any nonchange 200000 zat Orchard-family sends,
without emitting its UUID, destinations or raw transactions. No match is assigned
from amount alone. Unavailable/ambiguous account views stay unavailable.

The upstream beta.3 source extracts and stores a transaction before broadcasting:
https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/z_send_from_account.rs
and
https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/pczt_extract.rs.
The reported version is consistent with that source tag, but is not a verified
binary hash or evidence of wallet database continuity. Exact-account correlation
and whether the wallet database was restored/recreated since the attempt are
material before a no-send verdict. Do not clear or retry the unknown record from
the all-account counts. No production state has been mutated by these inspectors.

## Audited recovery candidate

The subsequent operator output identified the matching account with exactly the
known payment and confirmed refund, zero other transactions, zero unmined records
and zero nonchange 200000 zat Orchard-family sends. `getwalletstatus` then reported
node, wallet and fully synced height 4484530, with `locked=false`. The following
block query reported height 4475492/time 1791819667 after the attempt's following-day
cutoff, and latest stored height 4484533.

For this fixed 200000 zat direct Ironwood payment, the reviewed beta.3 send path
uses the standard builder expiry of target + 40 and records the transaction before
broadcast. The following-day block supplies a conservative target-height bound:
4475492 + 41 = 4475533, already 9000 blocks behind the stored tip. The tool does not
generalize that bound to ZIP 318 pool migrations, whose rolling expiry is longer.
It rechecks that the original payment and confirmed refund use Ironwood, validates
the original expected memo/order/route with the existing decoder, and fixes the
attempt ID, amount and creation time. The attempted amount is below the reviewed
canonical migration denomination floor of 0.01 ZEC. No expiry override exists in
the inspected `z_sendfromaccount` pipeline. Host/chain clocks and the reported
standard beta.3 implementation are trust assumptions; no claim of binary-hash
attestation or recovery of the exact historical RPC error is made.

The operator tool performs fresh live RPC and SQLite checks before any write:
matching chain hashes/heights and full sync, exactly the two known account
transactions, confirmed earlier refund with the same Orchard receiver, protected
route equality across stores, the exact unchanged unknown ledger row, and a fresh
expired-window snapshot. Unknown, unrecognized or changed evidence blocks it.

After the isolated candidate is healthy and running the matching source revision:

```bash
cd ~/nostos/repo
git pull --ff-only origin main
sudo python3 scripts/web/reconcile-item21.py
```

Default operation is a read-only dry run. If eligible, explicit application is:

```bash
sudo python3 scripts/web/reconcile-item21.py --apply
```

Apply atomically appends a `refund_resolutions` evidence record and marks only the
specified unknown instruction `failed`, with no transaction ID invented. This
means unsuccessful settlement after reconciliation, not a recovered RPC rejection
message or proof that no packet was ever broadcast. The original instruction,
idempotency key, amount, creation time, retry count, earlier confirmed refund,
legacy mirror and both encrypted routes remain. A repeat is idempotent. No send
method exists in this recovery path; the old key cannot be resent. The 200000 zat
reservation is released only after successful apply, restoring accounting value,
not wallet funds. Fees remain extra merchant spending; any new instruction needs
separate merchant authorization and the existing funding/receiver checks.

The wrapper refuses a checkout/live release mismatch or a deployment without the
new reconciliation capability. A timeout/error during apply reports unknown
mutation state and requires inspection, not an assumption that rollback occurred.
Do not restore an old database snapshot. Older releases fail closed on the new
failed event; continue with a compatible release for correct accounting/display.

Deployment and live apply are not proved by local tests alone. The subsequent
operator apply result is recorded at the top of this document and in the evidence
JSON. It supersedes the unknown reservation state. Existing privacy, merchant
withdrawal/mainnet, demo/video and submission gates remain open. No new payment or
refund was sent by reconciliation.

Source references:

- <https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/pczt_create.rs>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_primitives/src/transaction/builder.rs>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/components/zcash_protocol/src/zip318.rs>
