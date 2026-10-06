# Customer refund requests and remaining-value refunds

## Product behavior

The private receipt holder can request an amount within the remaining payment value and give a reason. A receipt capability permits reading and requesting, never spending, identity verification, or proof of payer control. No new return address is accepted by the request endpoint.

The owning merchant reviews the request and supplies a decision reason. Approval may cover the whole requested amount or a smaller amount. Approval is a deliberate signing action through the same hosted Zallet account and FullPrivacy path. Declining creates no refund instruction. Decisions and refund status appear on the same private receipt.

Merchants can also issue a direct refund where there is no open customer request. Every review produces a distinct instruction key. An approval uses a fixed key derived from the request ID. Amount and payment are immutable for that key. Repeat submissions return the recorded transaction; an active or unknown broadcast blocks another send. The accounting reservation is protected by a SQLite write transaction across processes.

Refund amounts are merchant decisions. Wallet fees are paid by the merchant account in addition to the refund amount. A balance equal to the full payment cannot cover a full refund plus its fee. This change does not silently deduct fees or fund the merchant account.

## Refund ledger and upgrade

The additive `refund_events` table records every individual instruction and transaction. Existing `refunds` rows are imported by explicit column name, including databases where `retry_count` was appended by an older migration. Original IDs, amounts, transaction IDs and retry counts remain intact. Reopening the store does not duplicate events.

The original `refunds` table retains the first real instruction for compatibility. Its state, transaction ID and retry count mirror that instruction, never a fabricated aggregate. Keeping its payment-unique guard prevents an older release from treating a payment with a new instruction as never refunded. New code reads the complete event ledger for totals. Confirmed refunds plus reserved sends cannot exceed the original payment. No new instruction can start while another is pending, broadcasting, broadcast, or unknown.

Historical releases only understand the first refund. They do not show cumulative amounts or customer requests, and their old partial-refund cleanup still applies. A health-failure rollback before new traffic preserves the original tables and container. After multiple refunds have occurred, use a release that understands this ledger for continued product operation. Never restore an old database snapshot after a broadcast: that would discard spending history. Rollback does not erase the event ledger. A later compatible release can recover an older partial route as described below.

## Privacy and retention

Request and decision reasons use the existing AES-GCM product codec. They are returned only to the owning merchant and the relevant receipt capability holder. The API uses explicit projections, no-store responses and fixed error text. The customer cannot supply a wallet/account, destination, signing capability or merchant identity to an approval.

The receiver invariant remains strict: expected NOSTOS memo, then a wallet-validated Orchard-only return route on the same network. There is no transparent, TEX or Sapling destination fallback. Ironwood funding remains selected through Zallet's `orchard` fund-source interface. A confirmed outgoing refund must match its destination receiver, integer amount and Orchard/Ironwood pool before accounting settlement.

A partial refund retains both encrypted route copies while there is remaining refundable value. A complete refund removes them after confirmation. An explicit merchant refund window may close remaining refund capability; open requests and unconfirmed or unknown sends delay removal until resolved. A Node runtime retention pass checks expired routes every five minutes, in bounded batches of 100, rotating past unresolved records so they do not prevent cleanup of later records, without wallet RPC or spending. Expiry is serialized with customer requests and refund reservations. Receipt visits also apply the same expiry checks.

The merchant's policy and window are saved with each new payment request. The window starts at payment confirmation. Policy edits do not shorten or otherwise change existing payment requests. Existing records have no newly imposed deadline. New requests default to 30 days if a merchant has no configured window. New policy edits require an integer from 1 to 365 days; an unset deadline is no longer offered. Existing requests with an unset window retain their original terms and capability; they are not silently assigned a deadline. Free-text policy conditions guide review; only the configured deadline and financial limits are enforced automatically.

Route deletion means removal from current product records. Wallet memo history, SQLite WAL pages, backups, previous releases and the retained keyed reuse fingerprint have separate retention properties. No cryptographic erasure or operator blindness is claimed. Hosted spending custody is unchanged.

## Older partial refunds, including Item21

The previous release removes a route even after a partial refund. Such records keep their confirmed payment and refund history. They are not silently revived during migration.

For a remaining balance, the authenticated owning merchant can select **Check original payment route**. This action reads the original transaction, requires one matching incoming shielded note, parses the original order and return route, validates Orchard-only capability, and matches the route against the preserved keyed fingerprint. Only that original route can be restored. An explicitly expired or fully repaid record cannot be revived. Recovery itself does not send funds, create a payment or change a transaction. Interrupted recovery can be completed by repeating the same checks.

The known Item21 payment remains the live fixture. No production database, wallet, node or release was changed during implementation. Its receipt confirmation is user-reported; the customer explicitly confirmed receiving the 0.018 ZEC refund in Noir on October 6, 2026. The screenshot was unavailable to the inspecting workspace; this is customer-reported evidence. Automatic Noir handoff remains unproved and is not fixed by this change.

## Validation and rollout

Tests cover capability scope, merchant ownership, encrypted request/decision text, input rejection, immutable keys, unknown-send blocking, concurrent reservations, cumulative limits, multiple partial settlements, full retirement, deadline snapshots, background expiry, and fingerprint-bound recovery from the original memo. These are local fixtures, not substitutes for the live payment.

The isolated deployment preview disables the background retention pass (`NOSTOS_RETENTION_ENABLED=0`) so preview startup cannot retire live routes.

Use `scripts/web/deploy.py` for an isolated build, candidate health checks, retained previous container and automatic failed-switch recovery. Do not restart Zebra or either wallet. Keep current source changes and runtime files intact. After deployment, verify the actual release mount, the existing Item21 receipt, and customer request/decision controls. Verify runtime logs and Noir independently before describing this as live verified.
