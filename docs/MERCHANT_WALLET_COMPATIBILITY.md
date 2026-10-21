# Merchant wallet compatibility checkpoint

Baseline: `3b8413417286cc8e802e562f4eda8d0605e88933`.
Branch: `feat/mainnet-wallet-compatibility`.
Delivery target: 25 October 2026, 18:00 WAT.

This checkpoint does not enable payments, modify runtime code, deploy services,
import live viewing keys or submit transactions. The pending staging commit
`734d26944b07cd5c75d074452b2c7a47cc9998f0` remains on its original branch.

## Selected signing workflow

The first candidate is ZODL Android's native software account in a dedicated
business wallet, with an independently backed-up recovery phrase held only by
the merchant. Hardware accounts, swaps, gift cards, migrations and send-max flows
are outside this checkpoint.

1. In the selected business account, use Advanced Settings, Export viewing key,
   and select **Full**, not Incoming. Native mainnet export is a ZIP-316 UFVK
   beginning `uview1`; `uivk1` is insufficient. Unsupported revisions, malformed
   keys and wrong-network keys must fail closed. No seed or spending key enters
   NOSTOS.
2. With merchant consent, import the full key into the separate observer. Persist
   the correct network, birthday and encrypted account claim before asynchronous
   work. The observer's Orchard-only scope retains that component's outgoing key.
   Verify the selected wallet's Orchard receiver belongs to this account, and
   derive the shielded-only business destination there. A mixed wallet display
   address is not itself an accepted refund route.
3. The customer sends the exact request amount and existing NOSTOS v1 memo to
   that business destination. ZIP-321 carries the memo bytes as base64url in its
   `memo` field. Manual address/amount/memo entry is the bounded fallback if the
   installed app does not open the URI correctly. Do not alter the paying memo
   schema to fit the wallet.
4. A refund instruction must be saved and approved in NOSTOS before displaying
   an exact shielded receiver, ZEC amount and short unique instruction memo for
   review in the merchant wallet. The wallet holds the spending key, displays
   fees and performs signing and broadcast after merchant approval. NOSTOS does
   not invoke an operator signer.
5. Keep an instruction pending after a wallet timeout, app closure or an
   unconfirmed txid. The wallet can resubmit the same transaction in the
   background. Do not create a replacement transfer or clear reservations from
   an error label. Independently match mined outgoing receiver, amount, pool,
   memo and account to the saved instruction before persistent settlement.

Possession of a full viewing key establishes viewing access, not signing-key
ownership. A later explicitly authorized control transfer is needed to prove
merchant signing and actual outgoing recovery. Export and signing must refer to
the same selected account. NOSTOS cannot stop an independent wallet user from
signing a second transfer manually; it can refuse duplicate instructions and
duplicate settlement accounting.

## Pinned source evidence

The latest published Android release inspected is `3.17.2-3157`, dated 20 October
2026, tree/commit `cb3fb2236056e0c3e3a6510964257584efb4ebd7`.
Its app source shows:

| Concern                     | Source evidence                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full versus incoming export | `GetVKUseCase.kt` reads the selected account; `AccountExt.kt` maps FULL to `account.ufvk` and INCOMING to `account.uivk`; FULL has a separate confirmation flow         |
| Account binding             | `CreateProposalUseCase.kt` chooses the selected account; `ZashiProposalRepository.kt` uses it to create the proposal and local `ZashiSpendingKeyDataSource` for signing |
| Memo/amount handoff         | `ProposalDataSource.kt` parses ZIP-321 on the configured network, validates the recipient, keeps memo bytes and proposes fulfillment for the selected account           |
| Explicit review             | Proposal creation enters the review screen; `SubmitProposalUseCase.kt` handles biometric approval and submission separately                                             |
| Pools                       | Business-account model includes separate Orchard and Ironwood balances; transaction/migration implementations distinguish the pools                                     |
| Uncertain broadcast         | Proposal submission retains txids and SDK retry plans; some displayed failures can still be followed by background submission                                           |

Upstream SDK source was inspected at
`828874217a22bbf6ab7df4ea59b59f295d059ff4`. Its ordinary broadcaster defaults to
`OvkPolicy.Sender`, and the encoder/native path carries that policy into
transaction construction. Native `OvkPolicy.Discard` explicitly disables outgoing
recovery. The ZODL app's ordinary proposal call does not override Sender.

This SDK commit is a source reference, **not** a proved mapping to the installed
Android release binary. The app tag declares `5.2.2-SNAPSHOT`; no immutable
published dependency-to-APK mapping was established. Do not claim cross-binary
compatibility from source inspection alone. Verify the actual installed version
and native key/transaction behavior in the authorized device gate.

The SDK's public `MAINNET_PRE_PORT` regression vectors show that its normal
seed-derived account exports retain revision-0 UFVK/address encodings. Those
public UFVK/address strings are used in the offline tests, without copying their
public mnemonic. They are public test material and must never be funded.

## Executable offline checks

`transaction_tests.rs` now exercises the actual pinned NOSTOS SDK with an
independently published wallet UFVK/address pair, rather than relying only on
NOSTOS-generated keys:

1. Decode the published full export, retain the Orchard key, bind the displayed
   Orchard receiver to the correct account, reject another account and import as
   `ViewOnly` idempotently across reopen.
2. Reject the corresponding incoming-only and wrong-network exports.
3. Recover the exact outgoing amount, recipient and memo in Orchard and Ironwood
   using the scoped full export after persisting/reopening a raw transaction.
4. Refuse refund confirmation when the sender discards its outgoing viewing key.
5. Parse the exact ZIP-321 shielded receiver, 1,800,000-zat amount and instruction
   memo with the actual pinned ZIP-321 parser.

These join the existing 15 observer tests. The new workflow runs the checks
on Ubuntu 24.04 x86_64 and native ARM64. It does not run the example's network
entry point, request a live key, start a VPS service, deploy or upload a wallet
artifact. Dependencies and compiler remain pinned. Application CI runs separately.

The encrypted transaction fixtures have deliberately invalid proof/signature
placeholders. They test serialization, decryption and storage only. Their mined
context is synthetic and test-local; persisted transactions remain unmined and
the production confirmed-store guard still rejects them. They prove neither
valid transaction signing nor a mined payment/refund.

## Gate result and next proof

The candidate is supported by the inspected source. Offline/native test results
must be recorded after the workflow completes. No fundamental signing-model
change is justified by the available evidence.

The complete wallet compatibility gate remains open until the actual installed
wallet proves full export, same-account shielded receipt, outgoing recovery with
the exported key and memo preservation. Native observer ARM64 tests do not prove
Android device behavior. A real key import, funded control transfer and later
funded payment/refund require separate approval under the implementation rules.

If actual full export is unavailable or the real refund uses Discard, do not
weaken matching or fall back to an incoming key. The smallest alternate is a
merchant-operated compatible signing wallet using Sender recovery, feeding the
same observer and immutable instructions. It requires review of the exact wallet
and its export/signing/recovery proof before selection. Do not change to hosted
operator custody or an untested SDK signer.

Major lifecycle integration is intentionally held at this checkpoint pending the
compatibility report. The existing mainnet operation hold remains unchanged.

Sources:

- https://github.com/zodl-inc/zodl-android/tree/cb3fb2236056e0c3e3a6510964257584efb4ebd7
- https://github.com/zodl-inc/zodl-android-wallet-sdk/tree/828874217a22bbf6ab7df4ea59b59f295d059ff4
- https://github.com/zcash/zallet/tree/987382f67e622915228686e9f956c6a9c9a7514c
