# Security boundary

## Never commit

1. Wallet seeds, mnemonics, spending keys, viewing keys, or exported wallet files.
2. RPC passwords, private keys, deployment credentials, or encryption keys.
3. Raw memo plaintext from a real payment.
4. Complete customer refund destinations in logs or public evidence.
5. Wallet or node data directories.

## Runtime rules

1. Customer and merchant demo wallets use separate data directories, credentials, and ports.
2. Wallet RPC binds to loopback only.
3. The browser never receives wallet keys or RPC credentials.
4. Sensitive destination data is decrypted only inside the trusted service.
5. Unknown broadcast state blocks retry until reconciliation.
6. Personal wallets and funds are outside the demo boundary.
