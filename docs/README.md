# Documentation

NOSTOS accepts shielded payments and uses the return route supplied with each payment for later refunds. The [project README](../README.md) covers the product and local setup.

## Product and design

- [Project status](BUILD_STATUS.md): confirmed mainnet result and deployed release.
- [Technical design](ARCHITECTURE.md): components, memo format and verification flow.
- [Security and privacy](SECURITY_BOUNDARY.md): access, custody and retention limits.
- [Merchant custody](MERCHANT_CUSTODY.md): external signing and viewing access.
- [Wallet compatibility](MERCHANT_WALLET_COMPATIBILITY.md): tested wallets and memo handling.
- [Refund requests](REFUND_REQUESTS.md): decisions, accounting and route retirement.
- [Observer records](OBSERVER_RECORDS.md): detection, verification and recovery states.

## Development and maintenance

- [Deployment](AUTO_DEPLOY.md)
- [Validation](CI_VALIDATION.md)
- [ARM64 builds](LOCAL_ARM64_BUILD.md)
- [Observer backups](SDK_OBSERVER_BACKUPS.md)
- [Expired refund recovery](EXPIRED_REFUND_RECOVERY.md)
- [Merchant funds](MERCHANT_FUNDS.md)

## Historical testnet tools

The [testnet setup](ZALLET_SPIKE_SETUP.md) and [evidence records](../scripts/evidence/README.md) describe the earlier hosted-wallet implementation. They are separate from the current mainnet setup.

Source and documentation are covered by the [MIT License](../LICENSE).
