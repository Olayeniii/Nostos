# Documentation

Start with the [project README](../README.md) and [demo guide](DEMO.md). Current behavior is documented here; old checkpoint diaries and superseded setup notes remain in Git history.

## Product and verification

- [Build status](BUILD_STATUS.md): source, installed preview, checks and remaining submission tasks.
- [Demo guide](DEMO.md): the existing confirmed result and a short product walkthrough.
- [Technical design](ARCHITECTURE.md): components, memo format and verification flow.
- [Security and privacy](SECURITY_BOUNDARY.md): who sees what, custody and retention limits.
- [Merchant custody](MERCHANT_CUSTODY.md): external signing and viewing access.
- [Wallet compatibility](MERCHANT_WALLET_COMPATIBILITY.md): ZODL, Cake Wallet, Noir and memo handling.
- [Refund requests](REFUND_REQUESTS.md): approvals, accounting and route retirement.
- [Observer records](OBSERVER_RECORDS.md): automatic detection, exact proof and recovery states.

## Operations

- [Expired refund recovery](EXPIRED_REFUND_RECOVERY.md): private operator procedure that preserves reservations.
- [Observer backups](SDK_OBSERVER_BACKUPS.md): encrypted archives and restore boundaries.
- [ARM64 builds](LOCAL_ARM64_BUILD.md): native toolchain and artifact checks.
- [Deployment](AUTO_DEPLOY.md): existing testnet auto-deployment and separate mainnet preview.
- [Validation](CI_VALIDATION.md): local checks and manual Actions workflows.
- [Merchant funds](MERCHANT_FUNDS.md): legacy hosted testnet controls versus mainnet wallet balances.
- [Testnet spike](ZALLET_SPIKE_SETUP.md): historical development path, not mainnet setup.

The [receipt image](screenshots/receipt-card-mobile.png) is a local UI fixture, not transaction evidence. [Historical evidence](../scripts/evidence/README.md) keeps its original network and provenance. It is not a current deployment report.
