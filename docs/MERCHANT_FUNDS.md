# Merchant funds

## Mainnet

Payments go directly to the merchant's external wallet. NOSTOS records payment and refund obligations and verifies them through viewing access. Wallet balances, spendability and transfers remain controlled by that wallet.

A reserved refund amount is application accounting, not a spending lock on external coins. The merchant must retain enough shielded funds for the refund plus its actual fee. A missing balance or incomplete scan must not be treated as proof that a recorded obligation disappeared.

Mainnet hosted withdrawal/signing is blocked. Move merchant funds through the merchant wallet rather than interpreting the legacy hosted Funds controls as mainnet custody.

## Hosted testnet path

The legacy testnet Funds page supports withdrawal review with current-password authorization, a validated shielded destination and a proposed fee. Confirmed sale principal remains reserved during its refund window and unresolved requests. Available earnings exclude open refund obligations, fee allowances and recorded withdrawal spending.

The configured allowance is a buffer, not an exact fee quote. Funding shortages do not reduce customer entitlement. Unknown refund or withdrawal outcomes block new spending until reconciled. Actual wallet balance and released sale accounting are separate limits.

Hosted withdrawal proposals and destinations stay inside the trusted server/wallet boundary. They are not exposed as unsigned signing material in the browser. This legacy path is not evidence of a live mainnet withdrawal.

## Operations

`scripts/web/configure-funds.py` and the testnet deployer use private node RPC settings. They do not configure a mainnet signer. Build containers must not receive live wallet mounts or keys. Use [deployment guidance](AUTO_DEPLOY.md) and preserve the ledger and prior release during rollback.
