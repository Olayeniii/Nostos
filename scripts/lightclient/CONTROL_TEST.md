# Private mainnet control harness

This prepares and checks one operator control attempt. It cannot import a key,
sign, send, enable payments or settle a customer refund. Building or downloading
it does not authorize a funded transaction, a live key import or a deployment.

## Prerequisites before any live use

- Obtain approval for the exact isolated host, viewing account, birthday, private
  import, provider access and transaction plan. Preserve testnet services.
- Use the separately prepared isolated SDK wallet with the approved business
  account already imported and fully scanned. The approved birthday must include
  its funding notes so ownership of the spent note can be checked.
- Stop only that isolated observer normally before running the worker against its
  root, when authorized. Its exclusive writer lock rejects competing processes.
  This harness neither stops services nor imports an account.
- Compare the successful CI log, tested commit and artifact provenance. Match the
  worker and Python SHA-256 values against that independent packaging log. Use the
  package matching the host's CPU and Ubuntu 24.04-compatible libc.
- Keep the control ledger in its own existing private directory on encrypted
  local storage. It must be separate from the observer wallet root. Files contain
  plaintext receiver, memo, txid and proof data behind mode 0600 permissions.
  The SDK backup helper does not include this separate ledger. An approved backup
  and restore procedure must cover both before this can count as recovery proof.

Do not run these commands yet without the approvals above. The uppercase path
labels below are placeholders, never keys, addresses, memos or transaction IDs.

## Prepare, review and bind

Run from a private local terminal with session capture, casting and screen
recording off. The tool rejects piped input and redirected output. Never paste
its private review output or the ledger into chat, CI or a diagnostic bundle.

```sh
python3 /ABS/control.py prepare /PRIVATE/control-ledger /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
```

The account UUID and separate account's mainnet Orchard-only UA use hidden
prompts. The tool saves one immutable plan per business account before network
access, generates its neutral random `nostos:control:` memo and prints only the
attempt ID. The native preflight verifies account binding, a canonical shielded
receiver outside the business key's scope and a fully scanned wallet. It does
not establish available funds, selected inputs or network activation on its own.

A failed preflight retains a draft and cannot be bound. Retry the same draft:

```sh
python3 /ABS/control.py preflight /PRIVATE/control-ledger ATTEMPT_ID /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
python3 /ABS/control.py review /PRIVATE/control-ledger ATTEMPT_ID
```

`review` deliberately displays the saved recipient and memo in that private
terminal. It does not authorize spending. Obtain separate approval for those
exact fields and the selected Android account/input pool before signing once.

The fixed control is 10,000 zatoshis to the separate account, an actual Ironwood
output, at least three confirmations and a transaction fee no greater than 10,000
zatoshis. The 20,000-zat business debit cap still requires the merchant's wallet
review: the checker proves a known business-account spend, not all input values
or the absence of other hidden outputs. No extra sends or replacements are
authorized. A funding payment, if needed, remains a separate approval.

After that one separately approved send, bind its existing txid at a hidden
prompt. A timeout must never lead to another send or replacement txid.

```sh
python3 /ABS/control.py bind /PRIVATE/control-ledger ATTEMPT_ID
python3 /ABS/control.py verify /PRIVATE/control-ledger ATTEMPT_ID /PRIVATE/observer-wallet /ABS/nostos-sdk-worker REVIEWED_WORKER_SHA256
```

Sync the isolated observer through the transaction using its existing approved
procedure before verification. The checker does not silently start a sync. A
failed or interrupted check retains the txid and marks the result unresolved.

## What verification means

The native worker fetches the full transaction and checks its txid, byte bounds,
consensus branch, mined height and inclusion in the provider's compact block
matching the SDK's scanned anchor. The current tip is checked before and after
enhancement. Stale scan state or a changed anchor cannot be stored as confirmed.

For this control it rejects any transparent, Sprout, Sapling or Orchard bundle.
It requires an Ironwood nullifier recorded for the bound business account,
including notes now marked spent. With that account's full viewing key it must
recover exactly one external outgoing output matching the saved recipient,
10,000-zat amount and full padded memo. Missing outgoing recovery, change,
ambiguous matches, insufficient confirmations and a fee above the cap fail.

The Python driver starts and closes the worker twice, requiring the same mined
output and anchor after a normal wallet reopen. It saves that private proof in
SQLite atomically. One txid cannot satisfy two attempts in the ledger. Repeated
checks use the same plan and txid; they do not create another settlement.

The HTTP broker still rejects `nostos_control`. Only the private operator pipe
can call it. Neither the harness nor its result is wired to product settlement,
refund reservations or mainnet payment enablement.

This remains hosted-chain evidence, not independent full-node consensus
validation. A successful result does not prove Android reopen, an independent
recipient's incoming recovery, offsite backup restoration or the complete NOSTOS
payment/refund cycle. Those gates remain separate. CI uses non-broadcastable
encrypted fixtures and mocked worker responses, never a funded control.
