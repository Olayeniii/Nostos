# Expired external refund recovery

This is a private operator action, not a merchant API or an automatic retry.
It does not sign, broadcast, settle a refund, or release its reserved amount.

The operator must inspect the external wallet's local export, matching the
transaction ID and exact refund memo, and record an unmined expired transaction.
The export stays on the operator's device. Only selected metadata enters this
action. This is operator-reviewed evidence, not a native cryptographic proof of
expiry. An operator who supplies false metadata can make the recovery unsafe.
Do not expose this entry point through HTTP or accept these claims from customers.

Requirements:

- An approved refund with one existing handoff, pending native reconciliation.
- Unchanged saved amount, route, account, memo, pool, approval and fee cap.
- Wallet scan and current mainnet height at least 100 blocks past expiry. The
  100-block margin is an operational policy, not a Zcash consensus requirement.
- Exact agreement between the chain connection and fully scanned observer tip.
- No output claim or settled refund and no different bound transaction.
- No mempool entry or returned transaction. RPC failure is accepted only with
  the configured adapter's numeric -5 result, alongside reviewed export evidence;
  missing transaction lookup alone never authorizes recovery.

Run `scripts/web/recover-expired-refund.mjs --dry-run` inside the private preview
using its existing environment and tsx loader. Supply the metadata JSON on stdin.
Review `ready: true`, then explicitly run the same action with `--apply`.

Metadata fields: `txid`, `memo`, `amountZat`, `feeZat`, `expiryHeight`,
`walletScannedHeight`, `minedHeight: null`, `walletStatus: "expired"`, and
`operatorReviewed: true`. Never provide a wallet database, viewing or spending key.

Application atomically appends the old transaction, encrypted memo, fingerprint,
checked heights and evidence provenance to `observer_refund_attempt_history`.
It rotates the attempt memo and fingerprint and resets handoff to unclaimed.
The existing refund stays reserved at the same amount and fee cap, with a pending
status and incremented retry count. It does not create another refund request.
Another review and password-authenticated wallet handoff are required.

Replaying identical recovery evidence never reopens a claimed handoff. Expired
transaction IDs cannot be bound or applied as output proofs. In-flight checks
using an old memo/fingerprint cannot settle a replacement attempt. Unknown
outcomes continue to hold reservations. Normal native proof remains required
for confirmation of a replacement refund.

Installation and recovery application request no send. A replacement still needs
its own wallet review and explicit signature.
