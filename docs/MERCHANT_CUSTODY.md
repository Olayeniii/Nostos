# Merchant custody

The mainnet path keeps signing in the merchant's external wallet. NOSTOS receives explicit viewing access to a dedicated business account and coordinates checkout and refund records. It never requests the merchant's recovery phrase, spending key or signing-wallet database.

## Connection

A verified merchant supplies the network-matching Unified Full Viewing Key, the account birthday and explicit scope consent through the authenticated connection flow. Incoming-only view access is insufficient for outgoing refund verification. The application encrypts the saved claim; the native observer retains the supported Orchard-family viewing component.

The key and birthday are bound before asynchronous import. An interrupted connection may retry the same claim, but cannot silently replace it or let another merchant claim the same key. Status responses omit the viewing key and internal account identifier. The merchant receiving destination is verified against that account.

A full viewing key proves viewing access, not ownership of spending keys. The service can inspect account activity covered by the key. Dedicated business-account use and clear consent are therefore part of the model.

## Refund approval

NOSTOS saves the approved amount, original return route, unique memo, account, pool and fee ceiling in an immutable instruction. A password-authenticated handoff returns wallet instructions once. The merchant checks these fields and the actual fee before signing in the wallet.

NOSTOS cannot force an external wallet to retain funds or stop its owner from manually sending another transfer. A ledger reservation prevents duplicate or excessive application instructions; it is not a lock on the merchant's coins. Missing outgoing evidence keeps the reservation unresolved.

## Separate legacy path

The historical testnet demonstration uses a hosted Zallet merchant wallet. Mainnet rejects hosted setup and signing operations rather than falling back to that wallet. Its keys, databases, credentials and services remain separate from the SDK observer.

See [wallet compatibility](MERCHANT_WALLET_COMPATIBILITY.md) and [security](SECURITY_BOUNDARY.md).
