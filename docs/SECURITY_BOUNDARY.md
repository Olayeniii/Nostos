# Security and privacy

## Who holds what

| Party                     | Access                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Customer wallet           | Customer spending keys and wallet history                                                                                 |
| Merchant signing wallet   | Merchant spending keys, fee review and transaction submission                                                             |
| NOSTOS service            | Checkout and refund records, supplied return routes, dedicated merchant-account viewing access and product encryption key |
| Chain provider            | Client network metadata and queried chain ranges or transaction references                                                |
| Receipt capability holder | That receipt's order, payment/refund status and allowed refund-request action                                             |

Mainnet NOSTOS does not hold merchant spending keys. A full viewing key cannot spend, but it can expose sensitive activity and memo data for the account it covers. Use a dedicated business account. The service is trusted for record handling and availability; this is not a trustless or operator-blind system.

Shielded note encryption protects transaction fields and memos on chain. It does not hide information entered into checkout from the service, or prevent address reuse, record correlation, network metadata or timing inference. A return address is a receiving destination, not a spend key. It proves neither payer identity nor control of the destination. NOSTOS does not implement draft Authenticated Reply Addresses.

## Application controls

- Verified merchant email, password reauthentication for wallet handoff, session ownership and exact trusted origins protect merchant actions.
- Checkout and receipt capabilities are record-scoped. They stay in URL fragments and API Authorization headers, rather than URL paths or query strings. A shared link remains a bearer capability.
- Product identity, route, memo and request fields use authenticated encryption. The server-held key can decrypt them. Selected amounts, statuses and accounting metadata remain readable in the ledger.
- Canonical Orchard-only refund destinations are required. Transparent, TEX and Sapling-only refund fallbacks are not supported.
- Exact native output proof is required before mainnet credit or settlement. An ID, wallet error label, submitted request or broadcast response is not confirmation.
- Pending and unknown outcomes retain reservations. A timeout never authorizes another wallet handoff. Operator-reviewed expiry recovery is separate from ordinary checks.
- RPC clients require parsed loopback endpoints, reject embedded credentials and redirects, and contain raw provider errors. Browser clients receive selected fields, not keys or raw wallet responses.

## Storage and retention

The native observer database contains its scoped viewing key, decrypted memos and transaction history in plaintext behind private filesystem permissions and a writer lock. Product-field encryption does not encrypt that SDK database. `age` protects observer backup archives; a restored database is plaintext again.

Full repayment or eligible expiry removes current product route copies. Partial refunds and unresolved obligations preserve their routes. Logical deletion does not erase wallet history, SQLite WAL/SHM, earlier releases, backups or the retained keyed reuse fingerprint. Historical testnet tools can produce plaintext local state and are not encrypted product storage.

The service rejects reuse of a saved canonical route within its own retained records. This does not prove the address was fresh elsewhere, authenticate the payer or prevent copies in wallet history. The hosted legacy testnet wallet has different custody from the mainnet observer path.

## Repository and deployment rules

Never commit wallet exports, seeds, spending or viewing keys, product encryption keys, RPC cookies, provider tokens, real payment memo contents or complete customer return destinations. Keep them out of logs, screenshots and public demo material as well.

Network isolation, live log access, backups, historical repository contents, infrastructure permissions and deployed dependency versions need their own review. Passing source tests or a current-file secret scan is not a complete infrastructure audit. The retained security-update branch has not been merged or installed as part of the mainnet payment release.

See [custody](MERCHANT_CUSTODY.md), [backups](SDK_OBSERVER_BACKUPS.md) and [expired refund recovery](EXPIRED_REFUND_RECOVERY.md).
