# Nostos

**A private way back.**

Nostos provides a refund lifecycle for shielded ZEC payments. A customer supplies a shielded refund destination and an opaque order reference in the original payment memo. The merchant can later send a full or partial shielded refund without asking the customer for another address. The customer should use a fresh destination; the current product does not prove that the address has never been used elsewhere.

Zcash note encryption protects the memo on-chain. This is a hosted merchant-wallet product: the NOSTOS operator controls merchant wallet keys and can read payment and refund details. The customer also sends the refund route to the service over HTTPS during payment preparation. NOSTOS does not promise operator blindness or transaction unlinkability.

## Current status

The testnet shielded payment, memo recovery, durable intake, safe partial refund and controlled phone UI proofs are preserved in `scripts/evidence/gate-g1.json`, `gate-g3.json`, `gate-g4.json` and `gate-g5.json`.

The merchant product now has account creation, store setup, payment requests, checkout, an owned payment ledger and private receipts. Local browser tests use a mock wallet and do not establish a new on-chain proof. See [product flow and deployment](docs/product-flow.md) for the current scope and remaining verification.

[Rendered receipt design](docs/screenshots/receipt-card-mobile.png) uses a local test fixture, not a new transaction. [Deletion review](docs/module-deletion-review.md) records the two-call-site examples and retention decisions.

Build started: `2026-09-29T00:01:43Z`

## Privacy audit status

Audit baseline: `f367b1180ee521ca574f3fed67ee9c0b5450bf07`, October 2, 2026. The adapter fixes below have isolated regression evidence; their presence in the running production release is not yet verified. PROVEN SAFE is scoped to the named boundary, not a whole-product certification. The privacy release gate remains open.

| Property                                                                                              | Classification | Evidence and remaining boundary                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC endpoint uses a parsed loopback HTTP host, has no URL credentials, and cannot follow redirects    | PROVEN SAFE    | Adapter regression tests cover host deception, embedded credentials, redirects and caller configuration changes. Runtime bindings and firewall remain unverified.                               |
| Adapter exceptions omit arbitrary wallet error text, encoded memos and nested error causes            | PROVEN SAFE    | Tests use synthetic plaintext, hex and base64url memos, invalid error codes, transport failures and JSON parser failures. This does not establish that existing logs contain no sensitive data. |
| Product refund routes and identity fields use authenticated encryption at rest                        | PROVEN SAFE    | AES-256-GCM source and storage tests. The server-held key can decrypt them; wallet storage and legacy records are outside this boundary.                                                        |
| Product customer response omits the full refund route and refund permission                           | PROVEN SAFE    | Explicit response projection and isolated boundary tests. Receipt holders still see order details, amounts and transaction references.                                                          |
| Checkout capability is excluded from HTTP URL paths and query strings                                 | PROVEN SAFE    | Fragment URL and Authorization-header implementation. Browser history and header logging are separate boundaries.                                                                               |
| All historical refund routes and memos are encrypted at rest                                          | PROVEN LEAK    | Legacy storage without a codec and spike state persist plaintext copies. Whether sensitive runtime copies exist or ever entered repository history still needs inspection.                      |
| Customer route is fresh outside NOSTOS and reuse of equivalent receivers is prevented                 | UNPROVEN       | Exact address-string HMAC uniqueness does not establish wallet history or canonical receiver uniqueness.                                                                                        |
| Public payment/refund linkage cannot be inferred                                                      | UNPROVEN       | No evidence establishes resistance to timing or other transaction correlations.                                                                                                                 |
| Runtime logs, backups, wallet RPC exposure and completed-route retention satisfy the privacy boundary | UNPROVEN       | Production inspection and a defined retention policy remain pending. Legacy HTTP error containment also needs review.                                                                           |
| Current merchant-to-customer product loop works with an independent customer wallet                   | UNPROVEN       | Real historical transactions are preserved; current product browser evidence uses a mocked wallet.                                                                                              |

Operator visibility is an intentional, disclosed trust requirement, not evidence of an unauthorized third-party disclosure. The product encryption key and hosted wallet capabilities let the operator recover routes and correlate payment/refund records. Application route deletion would not erase memo history retained by the wallet or copies in backups.

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

Use isolated testnet wallets only. Never use a personal wallet, seed phrase, spending key, or real credential in this repository, logs, screenshots, or evidence.

## Open source status

The repository remains private during the build window and will be made public for submission. A license will be selected before public release.
