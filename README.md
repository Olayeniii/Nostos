# NOSTOS

**A return route travels with the payment.**

Accept shielded Zcash payments and refund customers without asking for another address. The return route arrives in the original payment's encrypted memo and stays bound to that order. Your customers don't need a NOSTOS account.

## Pay, fulfill, refund if needed

1. Create a payment link for your customer.
2. Your customer adds a shielded return address and pays from a compatible wallet.
3. Track the confirmed payment and record fulfillment in your workspace.
4. When a refund is needed, review the amount and sign in your own wallet. The existing receipt updates after verification.

Your spending keys stay in your wallet. We use viewing access to check the dedicated merchant account. You and the service can read the return route; on-chain encryption does not make the service blind or prove who owns an address. Read the [privacy and security boundaries](docs/SECURITY_BOUNDARY.md).

## Try NOSTOS

[Open NOSTOS](https://nostos.iyforge.xyz)

NOSTOS is live on mainnet. Our completed mainnet test paid 0.001 ZEC and returned 0.0005 ZEC as a confirmed partial refund. Transaction fees are separate from the refunded amount.

- [Technical design](docs/ARCHITECTURE.md)
- [Build and deployment status](docs/BUILD_STATUS.md)
- [Documentation](docs/README.md)

ZODL may require loading the QR image in its own scanner. Some wallets omit the memo when opening a request. Always check the exact amount and transaction memo before signing. See [wallet compatibility](docs/MERCHANT_WALLET_COMPATIBILITY.md).

## Run locally

Use Node.js 24 and pnpm 11. Copy the settings you need from [.env.example](.env.example) into private runtime configuration. Keep wallet exports, credentials, keys and live databases outside the checkout.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @nostos/web build
pnpm --filter @nostos/web dev
```

Source startup does not configure email delivery or wallet access. Local checks use fixtures and mocks unless a command documents external services. Read [script guidance](scripts/README.md) before running deployment, recovery or wallet commands.

## Repository

| Path                  | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `apps/web`            | Merchant workspace, checkout, receipts and product API            |
| `apps/api`            | Shared payment views and refund request services                  |
| `apps/worker`         | Legacy hosted testnet intake and refund processing                |
| `packages`            | Memo format, network policy, accounting, database and RPC adapter |
| `scripts/lightclient` | View-only mainnet observer, broker, packaging and backups         |
| `scripts/web`         | Deployment, inspection, recovery and UI checks                    |
| `scripts/evidence`    | Historical testnet evidence                                       |
| `docs`                | Product, technical and deployment documentation                   |

Mainnet uses external wallet signing. The older hosted testnet path has separate keys, databases and credentials; it is not a mainnet signing fallback.

## License

NOSTOS is released under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
