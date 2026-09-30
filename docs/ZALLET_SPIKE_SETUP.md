# Gate G1: Zebra and Zallet setup

## Selected path

Use one testnet Zebra chain service and two isolated Zallet wallet instances:

1. Customer Zallet, separate data directory and RPC port.
2. Merchant Zallet, separate data directory and RPC port.
3. Both RPC listeners bound to loopback.
4. Each wallet has its own authentication cookie or RPC user.

`zcashd` is not used because it has reached end of life. The spike uses Zallet's `z_sendfromaccount` method rather than `z_sendmany`. The account-based method selects an explicit Orchard or Sapling fund source and returns the transaction identifier directly.

Official references:

1. <https://z.cash/support/zcashd-deprecation/>
2. <https://zcash.github.io/zallet/guide/setup.html>
3. <https://zcash.github.io/zallet/rpc/index.html#z_sendfromaccount>
4. <https://zcash.github.io/zallet/operations/index.html>

## Runtime requirement

Install and sync the current compatible Zebra and Zallet releases on the wallet host. Follow the Zallet setup guide for the selected Zebra or Zaino backend. Do not expose wallet RPC outside loopback.

The two Zallet instances may use the same synced chain backend, but they must not share wallet data, account state, credentials, or RPC ports.

## Environment

Copy `.env.example` to a local ignored environment file. Set:

1. Customer and merchant loopback RPC URLs.
2. A cookie file path or RPC user and password for each wallet.
3. `NOSTOS_NETWORK=testnet`.
4. Payment and refund amounts.
5. A safe opaque order reference.

Load the environment into the shell before running the spike. Do not pass a seed phrase, spending key, or RPC password as a command argument.

## Run order

```bash
pnpm spike:setup
pnpm spike:send-payment
pnpm spike:scan-payment
pnpm spike:send-refund
pnpm spike:verify
```

After `spike:setup`, fund only the printed customer address using isolated testnet ZEC. Wait for confirmation before sending the payment. Wait for confirmation between each later transaction step.

## Pass condition

Gate G1 passes only when `spike:verify` writes `scripts/evidence/gate-g1.json` with two real confirmed testnet transaction identifiers.

## Failure rule

If `z_sendfromaccount` cannot spend the confirmed externally funded note, stop. Replace only the wallet adapter path and rerun this spike. Do not start the interface or database build, and do not label a local or simulated result as real.
