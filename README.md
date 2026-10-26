# NOSTOS

**A return route travels with the payment.**

NOSTOS adds refunds to shielded Zcash checkout. The customer supplies a shielded return address with the original payment memo. The merchant can later issue a full or partial refund to that saved route, without asking for another address. Customers do not need a NOSTOS account.

## How it works

1. The merchant creates a payment link.
2. The customer adds a return address and pays from a compatible wallet. NOSTOS checks the encrypted memo and exact payment details.
3. If a refund is needed, the merchant approves it and signs in their own wallet. NOSTOS verifies the outgoing payment and updates the existing receipt.

The service has viewing access to the dedicated merchant account, but no spending key. The merchant and service can read the refund destination. Shielded encryption protects payment details on chain; it does not make the service blind or prove who owns a return address. See [security and privacy](docs/SECURITY_BOUNDARY.md).

## Status

A mainnet payment of 0.001 ZEC and a partial refund of 0.0005 ZEC were confirmed in the private mainnet preview. The reviewed update is merged, normal verification is restored, and the original records are preserved. The operator subsequently confirmed publication at https://nostos.iyforge.xyz with mainnet commerce enabled, existing records preserved and the observer unchanged.

- [Website](https://nostos.iyforge.xyz)
- [Demo guide](docs/DEMO.md)
- [Build and deployment status](docs/BUILD_STATUS.md)
- [Technical design](docs/ARCHITECTURE.md)
- [All documentation](docs/README.md)

## Development

Requires Node.js 24 and pnpm 11. The web app also needs private configuration from [.env.example](.env.example); local source startup alone does not provide wallet access or email delivery.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @nostos/web build
pnpm --filter @nostos/web dev
```

Checks use fixtures and mocks unless a command explicitly documents external services. Do not put wallet exports, keys, credentials or live databases inside the checkout. Deployment and funded wallet actions are separate from local checks.

## Repository

| Path                  | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `apps/web`            | Next.js merchant workspace, checkout, receipts and product API    |
| `apps/api`            | Shared payment views and refund request services                  |
| `apps/worker`         | Hosted testnet intake and refund processing                       |
| `packages`            | Memo format, network policy, accounting, database and RPC adapter |
| `scripts/lightclient` | Native view-only observer, broker, packaging and backups          |
| `scripts/web`         | Deployment, inspection, recovery and UI checks                    |
| `scripts/evidence`    | Redacted historical testnet evidence                              |
| `docs`                | Current product, technical and operator documentation             |

The mainnet observer and the earlier hosted testnet wallet path are separate. Mainnet hosted signing is blocked. See [script guidance](scripts/README.md) before running operational tools.

Source licensing is currently `UNLICENSED`. No open-source license is granted by this repository.
