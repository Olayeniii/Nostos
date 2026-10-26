# Technical design

NOSTOS coordinates shielded payments and refunds. Customer and merchant wallets sign transactions. A separate observer reads the dedicated merchant account and checks outputs against durable instructions.

## Components

| Component             | Role                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| Next.js web app       | Merchant accounts, payment links, checkout, receipt and refund review            |
| Product SQLite store  | Encrypted identity, checkout, route, request and consent fields                  |
| Core SQLite ledger    | Payments, refund events, reservations, claims and reconciliation journal         |
| Local observer broker | Authenticated, merchant-scoped requests to native workers                        |
| Native SDK worker     | Orchard-family viewing, scanning, transaction enhancement and exact output proof |
| External wallet       | Spending keys, fee review, signing and network submission                        |
| Chain services        | Lightwalletd chain data and separate public transaction checks                   |

The broker and RPC connections use loopback interfaces. Browser requests go through the application, not directly to wallet RPC. The observer has no signing or broadcast method.

## Payment

The server fixes an opaque order reference and integer amount. Checkout validates and saves a canonical Orchard-only refund route. A shielded display address containing Orchard and Sapling can supply its Orchard receiver; transparent-containing and unsupported routes are rejected.

The payment memo is UTF-8 JSON with the exact fields `p`, `v`, `o` and `r`: protocol `nostos`, version `1`, order reference and return route. The codec enforces the 512-byte memo limit. ZIP 321 carries those bytes in its `memo` parameter. Display text is not a substitute for that memo.

Incoming candidate discovery includes spent received notes, is account-scoped and processes bounded batches. A candidate transaction ID does not credit a payment. Native verification must match the saved account, receiving output, amount, memo, pool, mined context and at least three confirmations.

## Refund

A customer receipt holder may request a refund. The merchant approves an amount, reviews an immutable instruction and signs in an external wallet. Review reserves principal in the ledger; approval alone does not sign or send. A saved handoff is claimed once, before wallet instructions are returned.

Dashboard refreshes and customer receipt visits check saved refunds. Outgoing candidate discovery includes spends of the observed account's notes. Settlement requires the exact saved receiver, amount, memo, account and pool, an owned spend, a fee within the saved ceiling, and confirmed chain context. Duplicate output claims are rejected.

Source fingerprints are checked again under database locks after asynchronous verification. The core journal commits the claim and accounting update together; product receipt projection can then resume after interruption without another debit or send.

## Networks and legacy code

Mainnet uses the SDK observer and external signing. The earlier hosted testnet path uses Zallet and separate databases, keys, RPC credentials and deployment settings. Mainnet does not fall back to hosted signing. Runtime network labels come from configuration, not an assumed build-time network.

See [observer records](OBSERVER_RECORDS.md) for status and recovery, and [security](SECURITY_BOUNDARY.md) for trust assumptions.
