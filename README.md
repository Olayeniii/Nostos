# Nostos

**A private way back.**

Nostos provides private refunds for shielded ZEC payments. A customer includes a fresh shielded refund destination and an opaque order reference inside the encrypted payment memo. The merchant can later send a full or partial shielded refund without publishing the relationship between the original payment and refund.

## Current status

Gate G0 repository foundation passes locally. Gate G1 passed on Zcash testnet with a confirmed shielded payment, encrypted memo recovery, and confirmed shielded refund. Gate G2 domain and schema tests pass.

Build started: `2026-09-29T00:01:43Z`

## Hard gate

No interface or database feature work starts until a command line spike proves all five steps on the selected real test network:

1. Generate a fresh shielded customer refund address.
2. Send a shielded payment with a Nostos memo.
3. Detect the merchant note and recover the memo.
4. Send a shielded merchant refund to the recovered destination.
5. Confirm the customer received the refund.

## Workspace

```text
apps/
  web/
  api/
  worker/
packages/
  core/
  memo/
  zcash-adapter/
  database/
  shared/
scripts/
  shielded-spike/
  evidence/
docs/
tests/
```

## Local checks

Requires Node.js 24 or later and pnpm 11 or later.

```bash
pnpm install
pnpm check
```

## Safety

Use isolated demo wallets only. Never use a personal wallet, seed phrase, spending key, or real credential in this repository, logs, screenshots, or evidence.

## Open source status

The repository remains private during the build window and will be made public for submission. A license will be selected before public release.
