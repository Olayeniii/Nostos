# Automatic payment review

This change adds a private native incoming-record candidate lookup. It reads at
most four distinct saved incoming transactions per call, includes spent notes,
and scopes results to the selected saved account. The existing broker namespace
and serial worker queue apply. Candidates never go to a public client.

Checkout polling advances a durable per-checkout cursor and wraps at the end.
Both supported pools are verified against the saved instruction. Wrong or delayed
candidates are revisited, never credited without the existing exact native proof.
Noir's returned reference still uses the same verifier. Manual reference entry is
collapsed under Payment recovery. Receipt polling uses the same checkout route.

Validation: 407 application tests, lint, type checking, formatting, source build,
secret scan and three broker tests passed locally. These are synthetic checks.
Rust is unavailable in the local executor. The new native SQL lookup and native
worker must compile and pass fixtures on the pinned operator host before install.
No real payment or refund has been tested by this change.

## Operator build gate

Keep the currently installed c370ee2 private preview running. Do not replace its
worker independently: web and worker must be updated together after review.
Do not use the old commerce installer for this revision: its source/hash pins
still target c370ee2. A matching installer update remains required.

On the existing ARM64 build host, fetch the exact reviewed PR commit, stage a new
isolated source and SDK build directory using the existing build helper rules,
and use Zallet 987382f67e622915228686e9f956c6a9c9a7514c with Rust 1.95.0.
Set NOSTOS_BACKUP_FIXTURE to the absolute staged
scripts/lightclient/backup_fixture.py before running native fixture tests.
Require all native fixtures and the optimized worker build to pass, record its
SHA256 and retain the old worker/container/config for rollback. Do not install
until a revision-specific installer preserves the current runtime data mounts,
data key, RPC cookies and wallet state, and checks unauthenticated POST / = 401.
Production and testnet remain outside this procedure.

## Remaining release gates

The hardcoded 10,000-zat refund verification ceiling has not been established as
compatible with the installed ZODL wallet. A refund with a higher fee remains
unresolved and its reservation must remain held; do not resend. Fee-policy work
and actual external-wallet evidence are required before funded testing.

Once-only external handoff and unknown-outcome reservations are unchanged.
Retained partial-refund routes and full-refund route retirement are unchanged.
Native restored-backup recovery, spending control, outgoing recovery and the
funded customer receipt/reopen proof remain unproved. Browser mocks cannot clear
these gates. No deployment or send is authorized by this document.
