# Refund requests and accounting

A private receipt holder can request a refund amount within the remaining payment value and give a reason. The receipt capability does not authenticate the payer or authorize spending. The request cannot supply a new return address.

The owning merchant approves or declines with a decision reason. Approval may cover the whole requested amount or less. On mainnet, approval records a decision; reviewing the approved refund reserves principal, and a separate password-authenticated handoff provides the immutable instruction for external wallet signing.

Wallet fees are additional merchant spending. They do not reduce the approved refund amount or count as money returned to the customer. Accounting availability is not proof of wallet funding or spendability.

## Ledger

`refund_events` records individual instructions. Original IDs, amounts, transaction references and retry counts are retained. The legacy `refunds` row mirrors its original instruction for older releases; it is not a fabricated aggregate. Current code derives totals from the full event ledger.

Confirmed refunds plus pending reservations cannot exceed the original payment. Active or unknown instructions block a competing refund. Repeated requests use the same saved instruction. Wallet timeouts and browser cancellation cannot clear a reservation or permit another handoff.

Refund confirmation requires the exact saved output and native evidence. Settlement updates accounting and the existing receipt. A partial refund leaves the unpaid remainder and original route available under the payment's original terms. Full repayment retires the current route copies.

## Policy and retention

New payment requests snapshot the merchant's policy and refund window. The window begins at payment confirmation; later policy edits do not change existing orders. New windows are 1 to 365 days, with a 30-day default when no policy is configured. Historical records with no deadline retain their original terms.

The retention pass checks expiry in bounded batches. Open requests and unresolved refund instructions delay route removal. Logical deletion does not erase wallet memo history, WAL/SHM, backups or previous snapshots. Request and decision reasons use the product encryption codec and are shown only to the owning merchant and the scoped receipt holder.

## Recovery and older records

A supported legacy partial refund whose route was removed can recover only the original route from its payment memo, with ownership, receiver and retained fingerprint checks. Expired or fully repaid records cannot be revived.

[Expired external refund recovery](EXPIRED_REFUND_RECOVERY.md) preserves the original attempt and reservation, checks reviewed expiry evidence and requires fresh wallet approval. It creates no new customer request and sends nothing.

The earlier hosted testnet path has separate signing and funding checks. Mainnet does not use those hosted send operations. Keep additive ledger history during deployment and rollback; never restore an old database snapshot to clear a broadcast.
