# Merchant product and private receipts

This extends the earlier single-operator proof UI with real merchant accounts. Historical G1/G3/G4/G5 records and their original database are preserved separately.

## Product loop

1. Merchant creates an account with email and password, then names their store.
2. Explicit store setup provisions a separate account and Orchard receiving address in the hosted testnet merchant wallet. Interrupted provisioning is blocked for reconciliation, not repeated automatically.
3. Merchant creates a request with a description and an exact zatoshi amount. NOSTOS issues an opaque memo order reference, a private checkout URL and a locally generated QR code.
4. Customer opens that link and supplies a fresh testnet unified refund address with an Orchard receiver from their own wallet. NOSTOS attaches the route once and prepares a ZIP 321 URI containing merchant address, amount and memo.
5. Customer sends a shielded testnet payment from a compatible wallet. URI/QR support must be tested per wallet; manual address/amount/memo copying is available. There is no assumed browser wallet connection and no server-funded payment button.
6. The merchant wallet scans for an incoming shielded note with the exact merchant destination, amount, order reference and return route. Confirmation is required before refund authorization. The browser cannot assert that a payment was received.
7. Merchant reviews a refund amount and explicitly submits the frozen amount. Ownership is checked against both the checkout and durable payment record. The existing claim/broadcast/unknown logic prevents automatic resend after uncertain outcomes. One refund instruction per payment remains the limit.
8. The customer's checkout link opens their receipt directly at `/receipt#capability`. Refund confirmation uses the merchant wallet's outgoing shielded transaction view; the receipt says "Refund confirmed" and directs the customer to verify receipt in their own wallet. Existing G5 evidence independently proves receipt in the original controlled customer wallet.

## Access and storage

Merchant sessions are revocable opaque tokens stored as hashes, in Secure HttpOnly host-only SameSite cookies. The customer capability is scoped to one request and its receipt; it does not authorize refunds or grant dashboard access. Capabilities stay in URL fragments and bearer headers, never query strings. QR generation is local, with no external QR service.

Product identity fields, request descriptions, memo references, wallet account identifiers, receiving addresses and return routes are encrypted with AES-256-GCM in separate SQLite databases. Account passwords use salted scrypt. The encryption key is separate from storage. Existing proof databases are not migrated or claimed to be encrypted by this change. Wallet storage remains operated by the VPS service and is outside this application encryption claim.

This is a hosted testnet merchant wallet, not a non-custodial browser wallet. NOSTOS and the operator can see the details required to process payments and refunds. Email verification, password recovery, arbitrary wallet integrations and production funds are not implemented.

## VPS deployment

From the existing repo after pulling main:

```sh
cd ~/nostos/repo
git pull --ff-only
sudo python3 scripts/web/deploy.py
```

The deployment helper archives tracked source into a new release, builds without wallet credentials, checks it on loopback port 3001, then switches only `nostos-web`. The original container stays running during the build. Existing environment, wallet mounts and runtime evidence are preserved. A failed switch restores the previous container. The helper creates a private product data key once and retains it on later deployments.

It does not modify Nginx, firewall rules, wallet services, Zebra, koko-memory or the disk guard. Keep port 3001 private and the application behind HTTPS. Do not run the old in-place build and container-replacement helpers for this new flow.

The helper has local configuration/rollback tests, but the first actual Oracle ARM64 deployment still needs the operator to run it. GitHub publishing is not VPS deployment.
