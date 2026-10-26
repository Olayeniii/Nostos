# Private account control check

`control.py` prepares and verifies a separate account-control transaction. It cannot import keys, sign, send, enable payments or settle a customer refund. It is separate from checkout and product accounting.

## Inputs and storage

The tool requires a fully scanned SDK business account, an isolated worker, the matching worker SHA-256 and a separate private control ledger. The account birthday must include its funding notes. The worker uses an exclusive writer lock, so a competing observer process prevents access.

The ledger contains plaintext recipient, memo, transaction reference and proof data behind mode 0600 permissions. It is outside the SDK wallet root and is not included in SDK observer backups. Private review requires an interactive terminal; piped input and redirected output are rejected.

## Commands

The paths below are placeholders for private local paths.

```sh
python3 /ABS/control.py prepare /PRIVATE/control-ledger /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
python3 /ABS/control.py preflight /PRIVATE/control-ledger ATTEMPT_ID /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
python3 /ABS/control.py review /PRIVATE/control-ledger ATTEMPT_ID
python3 /ABS/control.py bind /PRIVATE/control-ledger ATTEMPT_ID
python3 /ABS/control.py verify /PRIVATE/control-ledger ATTEMPT_ID /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
```

`prepare` saves one immutable plan per business account and generates a random `nostos:control:` memo. Hidden prompts collect the account UUID and a separate account's mainnet Orchard-only unified address. Preflight checks the account binding, canonical receiver outside the business key's scope and scan readiness.

`review` displays the saved recipient and memo. Signing remains a separate wallet action. `bind` saves the existing transaction reference; unresolved checks retain it. Repeated verification uses the same plan and transaction.

## Verification contract

The fixed check requires a 10,000-zat external Ironwood output, at least three confirmations and a fee no greater than 10,000 zats. It checks a known business-account spend, not every input value or the absence of other hidden outputs. A 20,000-zat total debit limit still depends on wallet review.

The worker checks transaction bytes, consensus branch, mined height, inclusion in the provider's compact block and agreement with the SDK scanned anchor. The current tip is checked before and after enhancement. Transparent, Sprout, Sapling and Orchard bundles are rejected for this check.

An Ironwood nullifier must belong to the bound business account. Outgoing recovery must find exactly one matching external recipient, amount and full padded memo. Change outputs, ambiguous matches, stale anchors, missing recovery, low confirmations and excess fees fail verification.

The Python tool reopens the worker and wallet and requires the same mined output and anchor twice. The proof is saved atomically. One transaction cannot satisfy two attempts.

The HTTP broker rejects `nostos_control`; only the private worker pipe accepts it. Results do not update product settlement or refund reservations. Verification uses hosted chain data, not independent full-node consensus validation. Tests use encrypted fixtures that cannot be broadcast and mocked worker responses.
