# Shielded spike

Gate G1 must prove a real customer payment and merchant refund before product feature work starts.

The spike provides five commands:

1. `pnpm spike:setup`
2. `pnpm spike:send-payment`
3. `pnpm spike:scan-payment`
4. `pnpm spike:send-refund`
5. `pnpm spike:verify`

The selected path is Zebra plus two isolated Zallet wallets. Sends use `z_sendfromaccount` with `FullPrivacy`. Outputs are redacted and proof is classified as real, local test, simulated, planned, or not supported.

See `docs/ZALLET_SPIKE_SETUP.md` before running the commands.
