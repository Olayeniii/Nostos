# Nostos

**A private way back.**

Nostos provides a refund lifecycle for shielded ZEC payments. A customer supplies a shielded refund destination and an opaque order reference in the original payment memo. The merchant can later send a full or partial shielded refund without asking the customer for another address. The customer should use a fresh destination; the current product does not prove that the address has never been used elsewhere.

Zcash note encryption protects the memo on-chain. This is a hosted merchant-wallet product: the NOSTOS operator controls merchant wallet keys and can read payment and refund details. The customer also sends the refund route to the service over HTTPS during payment preparation. NOSTOS does not promise operator blindness or transaction unlinkability.

## Current status

The testnet shielded payment, memo recovery, durable intake, safe partial refund and controlled phone UI proofs are preserved in `scripts/evidence/gate-g1.json`, `gate-g3.json`, `gate-g4.json` and `gate-g5.json`.

The merchant product now has account creation, store setup, payment requests, checkout, an owned payment ledger and private receipts. Local browser tests use a mock wallet and do not establish a new on-chain proof. See [product flow and deployment](docs/product-flow.md) for the current scope and remaining verification.

[Rendered receipt design](docs/screenshots/receipt-card-mobile.png) uses a local test fixture, not a new transaction. [Deletion review](docs/module-deletion-review.md) records the two-call-site examples and retention decisions.

Build started: `2026-09-29T00:01:43Z`

## October 19 refund reconciliation

The operator supplied successful guarded apply output at 11:15:50 UTC. The later
0.002 ZEC instruction is closed as failed, with zero reserved, both routes retained
and no new send. The earlier 0.018 ZEC refund remains confirmed. Remaining accounting
value is not wallet funding; the previously observed 190000 zat balance was short
of 200000 zat plus fees. The old instruction cannot be retried. See
[closeout evidence](docs/CLOSEOUT.md). Broader privacy and submission work remains open.

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

## External protocol review

See [the October 2 protocol review](docs/PROTOCOL_REVIEW.md) for the verified source baseline, information flow, custody and prior-work comparison. The follow-up patch validates Orchard-only return routes before intake and refund signing, tightens the 512-byte memo schema, and removes both product route copies after confirmed full repayment. It does not prove route ownership, freshness outside NOSTOS, production deployment, backup erasure or an independent current wallet loop. Customer requests, merchant decisions, cumulative partial refunds, policy snapshots, expiry cleanup and original-memo recovery are documented in [Refund requests](docs/REFUND_REQUESTS.md). These changes are verified locally; deployment and the independent Noir refund observation remain separate checks. The broader privacy release gate remains open.

## Merchant funds and separate mainnet support candidate

The merchant Funds page supports password-confirmed shielded withdrawal of released
earnings, with remaining refund principal and a fee allowance reserved. A wallet
proposal supplies the actual withdrawal fee before review. Atomic spending guards
block competing refunds and withdrawals; uncertain outcomes cannot be retried.
Item21 retains its original deadline and route terms.

Explicit mainnet configuration uses separate wallet/node RPCs, keys, databases,
network-bound stores and a separate isolated deployment. The existing auto-deployer
continues to serve testnet. No mainnet transaction, live withdrawal or production
custody readiness is claimed by this source candidate. Configuration and verification
steps are in [MERCHANT_FUNDS.md](docs/MERCHANT_FUNDS.md).

### Hosted mainnet connection

A self-hosted full node is optional. The preferred mainnet setup uses hosted Zebra
JSON-RPC with a separate local Zallet wallet and signing keys. A read-only private
endpoint probe and authenticated loopback HTTPS relay are prepared in source.
No hosted endpoint, wallet sync or mainnet transaction has been verified yet.
See [HOSTED_MAINNET.md](docs/HOSTED_MAINNET.md).
