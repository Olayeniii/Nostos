# Wallet compatibility

Wallet request parsing, signing and NOSTOS confirmation are separate steps. Always check the receiving address, exact amount and transaction memo in the wallet before approving.

| Wallet/path         | Observed behavior                                                                                                                                                     | Use in NOSTOS                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZODL Android 3.17.2 | Mainnet payment and refund were confirmed in the mainnet test. External-app opening can show a third-party scan error. Its own image scanner accepted the payment QR. | Save the QR and load it in ZODL's scanner when direct opening fails. Check amount, memo, spendable shielded funds and fee before confirming.       |
| Cake Wallet         | Testing populated the address and amount but omitted the memo. No completed NOSTOS Cake payment is claimed.                                                           | Enter the exact memo in the transaction memo field. If that field is unavailable, cancel. A wallet label or description is not the encrypted memo. |
| Noir extension      | An earlier testnet request reached approval but later failed consensus validation.                                                                                    | The adapter remains available, but that attempt is not evidence of a completed automatic payment.                                                  |
| Manual entry        | Address, exact ZEC amount and memo can be entered separately.                                                                                                         | Preserve all fields exactly. An entered transaction ID is a candidate, not proof of payment.                                                       |

ZODL full viewing-key export and outgoing memo support were reviewed for tag `3.17.2-3157`, commit `cb3fb2236056e0c3e3a6510964257584efb4ebd7`. This records the inspected version, not a promise about every wallet release or device. SDK snapshot dependency mapping was not independently attested to the installed APK.

## Payment requests

NOSTOS uses ZIP 321: the `memo` parameter carries unpadded base64url memo bytes. Display `message` text is not interchangeable with it. QR generation is local. A wallet must preserve the complete memo for NOSTOS to match the original order and return route.

A visible wallet balance may not yet be spendable. Shielding, synchronization, note selection and fee requirements are handled by the wallet. A fee failure does not justify lowering the approved refund amount automatically.

## Refunds

The merchant signs only the saved instruction, using the original canonical Orchard receiver and unique refund memo. The actual fee must fit the saved ceiling. NOSTOS checks an owned spend, the exact outgoing output and at least three confirmations before settlement. No hosted signer fallback is provided.

If a wallet remains pending or reports failure, preserve the transaction and instruction. It may retain a signed transaction or retry submission. Do not issue a replacement merely from that label; use [expired refund recovery](EXPIRED_REFUND_RECOVERY.md) when its evidence requirements are met.

Sources: [ZODL inspected release](https://github.com/zodl-inc/zodl-android/tree/cb3fb2236056e0c3e3a6510964257584efb4ebd7), [SDK source reference](https://github.com/zodl-inc/zodl-android-wallet-sdk/tree/828874217a22bbf6ab7df4ea59b59f295d059ff4), [ZIP 321](https://zips.z.cash/zip-0321).
