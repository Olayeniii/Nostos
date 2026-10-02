# Protocol review, October 2, 2026

## Baseline and evidence limits

GitHub main was read directly as `6d070ca066baa789313437bcf4c710ac67045a10`, parent `f367b1180ee521ca574f3fed67ee9c0b5450bf07`. All 124 tracked blobs were fetched or checked by Git blob hash against the working snapshot. The older local source directory has no HEAD and staged/untracked files; it was preserved. Changes use a separate content-verified snapshot, whose local snapshot commit is not the upstream commit identity.

The public `/sign-up` returned HTTP 200. No SSH credentials, Docker executable or production socket are available here. The running revision, service state, rollback container, wallet bindings, firewall, logs and production dirty state are UNPROVEN. The last explicit release output names f367b118; a later user report of completion does not establish a container revision. No deployment or real transaction was performed for this review.

The 6d070ca adapter patch is PROVEN SAFE within its source/test boundary: parsed HTTP loopback hostname allowlist, no URL credentials or fragment, copied configuration, redirects rejected, fixed operation diagnostics, numeric error codes, no wallet error text or original exception causes. Its 26 regression tests passed. This is FIXED IN REPOSITORY, not evidence of DEPLOYED or LIVE VERIFIED status. `localhost` still depends on the host's name resolution; runtime configuration remains a separate check.

## Actual product flow

`apps/web/src/product-service.ts` and `product-store.ts`, the product API, checkout and receipt pages implement:

1. Email/password account, immediately authenticated. Email syntax is checked; email ownership is not verified. Recovery is missing. Passwords use salted scrypt; sessions store SHA-256 capability hashes, expire after eight hours, and use Secure/HttpOnly/SameSite=Strict cookies.
2. Server creates a distinct Zallet account and Orchard merchant address. Interrupted setup blocks repeat account creation and requires reconciliation.
3. Merchant creates a description, amount and opaque order reference. Shared `/checkout#capability` opens the customer side. Fragment is absent from HTTP path/query, but exists in browser history. The capability goes to the API in Authorization headers.
4. Customer supplies a testnet return route over HTTPS. Server validates it, stores it encrypted and builds the JSON memo and ZIP 321 URI. The locally generated QR contains the complete payment URI. `memo` contains base64url memo bytes; `message` is not used.
5. External customer wallet signs the actual payment. NOSTOS requests no customer seed, spending key or viewing key.
6. Web reconciliation checks incoming direction, shielded pool, exact destination, integer amount, parsed order and route, and a wallet transaction view with at least one confirmation. A browser-submitted txid is not payment proof. The wallet adapter's transaction-view txid is the requested identifier, not a separate publicly verified identity proof.
7. Merchant authorizes one refund instruction. Hosted Zallet signs with account-scoped Orchard funding and FullPrivacy. Durable broadcast claims prevent concurrent sends. Unknown responses block retry. Confirmed refund output must match direction, destination, amount and shielded pool.
8. Capability holder reads NOSTOS receipt status; their wallet independently checks receipt of funds. The receipt is not a ZIP 311 disclosure or proof of customer identity.

Customer refund requests are MISSING. Receipt access currently confers read permission, not authorization to spend or proof of being the payer. A future request capability must not ask for another route or automatically authorize payment. External fulfillment failure signals are MISSING; NOSTOS does not know whether an NFT or other item was delivered. Merchant decisions and future authenticated integration signals must stay separate from actual refund authorization.

## Information and key boundaries

| Data                                         | Plaintext locations                                                                                                        | Protection/storage                                                           | Visibility                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Supplied route and memo                      | Customer browser/clipboard/QR, HTTPS prepare handler, wallet-decrypted note, authenticated local wallet RPC, server memory | Zcash note encryption on chain; AES-256-GCM in product checkout/core records | Customer, hosted operator, relevant merchant viewing capability; full route omitted from receipt and masked in merchant projection |
| Amount, status, transaction references, time | Wallet/RPC, server, database and scoped browser projections                                                                | Product amount/status/txids/timestamps remain plaintext                      | Operator, merchant and receipt capability holder; public txid alone does not reveal shielded note details                          |
| Order and description                        | Customer/merchant projections, server memory; order in memo                                                                | Product fields encrypted at rest; note encryption for memo                   | Operator and permitted browser recipients; correlatable within service                                                             |
| Merchant email/name/account/address          | Auth/setup handler, server memory; limited identity projection                                                             | Selected fields AES-256-GCM; email lookup HMAC                               | Operator; email/name in merchant browser; customer sees store name                                                                 |
| Password and session                         | Password at sign-in handler; session cookie in browser                                                                     | Salted scrypt; session hash in database                                      | No password projection; HttpOnly restricts script cookie access                                                                    |
| Receipt/checkout token                       | Fragment/history, API Authorization header, server memory                                                                  | Hash lookup; merchant-recoverable token encrypted                            | Bearer holder and operator; shared link grants status access                                                                       |
| Product data key                             | Server runtime and deployment key file                                                                                     | 32-byte server-held AES key, random 12-byte nonce and GCM tag                | Operator can decrypt historical selected fields; no forward secrecy                                                                |
| Wallet cookie and wallet keys                | Wallet/server environment                                                                                                  | Private local RPC; wallet storage outside product encryption                 | Operator can view and spend; browser receives neither capability                                                                   |

PROVEN SAFE: selected product encryption fields and explicit browser projections, based on source and tests. This is not operator blindness. Viewing/spending custody remains with the hosted operator. Browser preparation sees route data because the customer enters it there.

PROVEN ISSUE: legacy stores without a codec and spike JSON persist plaintext routes/memos; no proof that sensitive runtime copies or Git-history contents were purged. No new migration/deletion of historical evidence was performed. Product and legacy records can correlate amounts, orders, txids and merchant associations.

UNPROVEN: actual proxy/container/wallet logs, Authorization header logging, IP retention, backups, firewall, RPC bindings, infrastructure access controls, wallet sync metadata, historical secret content and public timing linkage. No third-party analytics were found in the inspected app source; that does not prove absence at infrastructure level. Clipboard, wallet handoff and screenshots may carry route/memo data. Privacy release gate remains open.

## Confirmed protocol issues and fixes

Before this change, memo decoding accepted unchecked/odd hex, oversize memo strings and extra fields. Legacy intake did not validate the refund receiver, and refund signing trusted stored route syntax. Web preparation only checked truthy Orchard presence. Those are PROVEN ISSUE findings.

The patch adds strict hex/UTF-8 and 512-byte decode bounds, exact p/v/o/r schema, field types and version rejection. Wallet decoding must return only a usable Orchard single-receiver UA on the same network; transparent, TEX, Sapling-only, mixed, malformed and missing capability responses fail before persistence/signing. Validation runs during preparation, reconciliation, intake and refund execution. No transparent fallback exists. Legacy intake requires incoming shielded notes and skips malformed memo records.

Freshness remains UNPROVEN outside NOSTOS. Reuse enforcement still uses a keyed exact-address fingerprint; historical mixed routes and equivalent-receiver canonicalization are not covered by that claim. Payer ownership, present control and continued control are not proved. The invariant is refund to the validated Orchard route supplied inside the paying note's memo.

Memo v1 is UTF-8 JSON `{p:"nostos",v:1,o:order,r:route}` represented as hex in RPC and unpadded base64url in ZIP 321. Real order references have 34 ASCII characters: 68 bytes of non-route overhead, leaving 444 bytes for the route. With a 64-character order, capacity is 414 bytes. Boundary tests cover exactly 512 and 513 bytes. No authenticated-address proof is added.

## Retention

Product routes previously remained indefinitely. The patch removes both product route fields after confirmed refund settlement, preserving amount, order, txids, confirmations, receipt capability and status. Core status becomes refunded; an empty route is valid only in that terminal state. Cleanup is idempotent and resumes across interruption between the two database writes. Pending/broadcast/unknown routes remain for reconciliation. A partial refund also finishes the existing single-instruction lifecycle; no later second refund is supported.

SQLite secure_delete is enabled. This is logical application deletion, not proof that WAL files, backups, wallet memo history or prior snapshots no longer contain material. The keyed reuse fingerprint remains. No cryptographic erasure or operator blindness is claimed. A refund expiry window is not defined in the existing product, so expiration and unpaid-route retirement remain pending an explicit merchant policy. Do not silently impose a deadline on existing payments.

## Custody and wallets

Hosted wallet is WORKING in existing implementation/evidence; independent current product wallet loop is UNPROVEN. Merchant-controlled spending is the preferred direction only after proof of a usable replacement.

| Option                        | Evidence                                                                                           | Remaining proof                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Zallet hosted/local connector | Current NOSTOS account, memo and signing RPC path; source docs describe unified viewing-key export | Installed version's Orchard viewing import, view-only memo recovery, merchant approval integration and normal setup |
| Zingo desktop                 | Maintainer README documents mainnet/testnet/regtest and ZIP 321 handler with memo                  | Installed binary with NOSTOS memo, fresh Orchard-only route selection and complete independent loop                 |
| Zingo mobile                  | Maintainer source describes shielded Android/iOS wallet and test infrastructure                    | Judge-accessible testnet build, actual URI/memo behavior and Orchard-only route generation                          |
| YWallet                       | Maintainer documents shielded memos and payment URIs                                               | Current testnet installation and exact NOSTOS loop                                                                  |
| Browser wallet                | No tested compatible connection/approval path established                                          | Network, memo recovery, viewing scope and refund approval                                                           |

Zallet's published RPC book says viewing-key import is Sapling-only; newer source documentation describes unified viewing-key-related changes. This inconsistency and absent runtime version make Orchard viewing-only adoption UNPROVEN. Do not switch custody based on generic viewing-key support. Viewing capability can reveal payment memos even without spending authority. A local merchant connector may preserve spending custody but setup/maintenance usability is untested.

## Prior work and accurate scope

- [Authenticated Reply Addresses](https://zips.z.cash/draft-ecc-authenticated-reply-addrs), created November 12, 2023, is Draft. It proposes a reply UA plus proofs tied to payment senders. NOSTOS bare memo route is not that proof and does not implement the draft.
- [ZIP 316](https://zips.z.cash/zip-0316) defines UAs and viewing keys. UA format alone does not establish NOSTOS receiver policy or payer ownership.
- [ZIP 321](https://zips.z.cash/zip-0321) defines payment URIs. NOSTOS uses its memo field, not display-message text, for the route.
- [ZIP 311](https://zips.z.cash/zip-0311) is a draft payment-disclosure design. NOSTOS receipts are application status, not that disclosure; no usable wallet implementation was proved here.
- [ZGo author's description](https://forum.zcashcommunity.com/t/zgo-the-zcash-register/41885) describes shielded merchant checkout, order/shop/device memos and invoice links. Those overlap with NOSTOS merchant payments.
- [CipherPay author's description](https://forum.zcashcommunity.com/t/cipherpay-yes-another-zcash-payment-processor-sorry-live/54830) describes deployed Orchard trial decryption with merchant viewing capability, invoice-specific addresses and ZIP 321 checkout. This is evidence of nearby noncustodial merchant processing, not a tested NOSTOS refund-signing integration. Do not copy its author's broad viewing/privacy claims without verifying key scope.
- [Zecwallet reply-to discussion](https://forum.zcashcommunity.com/t/several-questions-on-zecwallet/37783) discusses memo reply addresses. It establishes prior reply-to UX, not authenticated address ownership or the complete NOSTOS refund lifecycle.

No first-ever or absence-of-competitors claim is justified. NOSTOS's product contribution is a merchant payment/refund lifecycle around a payment-specific route in the original paying memo, with later refunds requiring no new address request.

## Remaining release gates

Privacy: production logs/exposure, historical plaintext inventory and Git-history scan; expiry policy and backup/wallet retention boundaries.

Usefulness: independent compatible customer wallet, account verification/recovery, customer refund request and clear merchant link sharing. Email improvements do not solve custody.

Execution: current live revision and rollback proof, existing isolated release test, then actual new shielded payment/refund confirmation without staging or database surgery.

Originality: preserve original build commits and real transaction evidence; accurately acknowledge protocol and merchant-tool overlap.

No mainnet migration, browser wallet connection, draft authenticity proof or NFT-specific automation is included. No event eligibility rules are inferred from older hackathons.

## Noir checkout follow-up

The user tested the official Noir testnet extension on Mises, generated another receive address and obtained faucet funds. Checkout preparation failed. A read-only production RPC check reported Orchard=true, Sapling=true, p2pkh=false, p2sh=false, unknown receiver count=0 and a 250-byte original memo. This proves rejection at the original mixed-receiver validation check; it does not prove the complete wallet payment/refund loop.

Checkout now accepts an Orchard+Sapling shielded UA as input, extracts the wallet-reported single-receiver Orchard UA, independently decodes it and requires Orchard-only capability on the same network. Only the extracted Orchard UA is persisted and encoded inside the paying memo. Intake, reconciliation and refund signing continue to require Orchard-only routes. Transparent-containing, unknown-type and missing-Orchard inputs remain rejected. Repeated preparation compares the normalized route; equivalent checkout inputs producing the same Orchard UA share the reuse fingerprint. This does not prove freshness outside NOSTOS or retroactively normalize historical records. No side-channel refund route or weaker refund fallback is added.

Validation: 144 tests and full repository checks passed. Production deployment and actual Noir payment/refund remain pending.
