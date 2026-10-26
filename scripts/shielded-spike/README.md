# Historical testnet spike

The original development proof used Zebra and two isolated Zallet wallets. It is retained for reproducibility and is separate from the current mainnet SDK observer path.

The commands are `pnpm spike:setup`, `pnpm spike:send-payment`, `pnpm spike:scan-payment`, `pnpm spike:send-refund` and `pnpm spike:verify`. Send commands use the configured testnet wallets and are not part of local checks or the submission recording.

Read [testnet setup](../../docs/ZALLET_SPIKE_SETUP.md) before use. Local spike state can contain plaintext private data and must remain outside source control. Do not use a personal wallet or substitute mainnet credentials.
