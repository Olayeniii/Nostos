# Observer records and reconciliation

`apps/web/src/observer-records.ts` connects native view-only verification to the payment ledger and receipt projection. Mainnet commerce requires the separately configured SDK observer and explicit feature flags. The observer cannot sign or broadcast.

## Automatic checks

Incoming discovery scans bounded, account-scoped candidate batches, including transactions whose received notes were later spent. Checkout and receipt polling can verify the exact original payment without customer transaction-ID entry.

Merchant dashboard refreshes reconcile one saved refund at a time, oldest check first. Customer receipt polling also checks approved refunds. Checks work after a panel closes or a page reloads. Browser reads are discarded when the page becomes hidden; returning, reconnecting, focusing or restoring the page starts a fresh read while keeping existing records visible.

A candidate is never settlement evidence. Verification derives the account, receiver, amount, memo, pool and fee limit from saved records. The native worker requires confirmed chain context, an exact unique output and, for a refund, an owned spend. It checks the mined anchor and current scanned tip. A transaction or output cannot satisfy two instructions.

## States and recovery

The interface distinguishes waiting for wallet approval, refund detection, confirmations, observer catch-up, verification service availability and a confirmed transaction whose output has not passed the saved checks. These are diagnostic states, not permission to send again.

Manual recovery lets the merchant save the existing transaction reference and check it against the same instruction. Error responses use allowlisted categories and fixed messages; raw provider or wallet diagnostics are not returned. Missing chain lookup alone does not prove a transaction failed or expired.

A core journal commits the output claim and ledger update atomically. Fingerprints are rechecked under locks after asynchronous proof. Interrupted product projection can resume without another debit, wallet handoff or RPC proof. Full repayment retires the original route; partial repayment preserves it.

Unknown outcomes retain reservations. [Expired refund recovery](EXPIRED_REFUND_RECOVERY.md) requires privately reviewed wallet evidence and rotates the attempt memo while preserving the original record and amount. It never signs, broadcasts or confirms a replacement.

## Trust boundary

The SDK checks inclusion against its scanned chain view supplied by hosted services; this is not independent full-node consensus validation. Native fixtures exercise real note encryption and decryption, but use invalid proof/signature placeholders and cannot be broadcast. Application transport mocks do not establish a funded transaction.

See [build status](BUILD_STATUS.md) for the confirmed mainnet result.
