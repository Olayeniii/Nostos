# Observer backend review, 20 October 2026

This review follows recovery of the operator's original resource screenshot:
Zcash developer docs, ZIPs, librustzcash, Zebra, ZODL and NEAR Intents. That list
does not prescribe Zallet, Zaino, a custom relay or self-hosting a node.

## Current failure and evidence limit

The last fatal log supplied by the operator is a recover-history sync exit at
20:38:08 UTC after RPC error -32000, `Chain RPC unavailable.` That generic error
originates in our relay and hides the method and underlying failure. Source fixes
to time limits and RPC envelopes do not prove compatibility under sustained sync.
The newer fixed-category diagnostic has been installed, but the latest supplied
startup output has no ready indexer, no cookie, no indexed height and no diagnostic
failure. It therefore does not identify the remaining cause. Do not infer an
outage, provider quota, corrupted wallet or successful sync from these records.

The supported RPC requirements must be checked across startup, subtree recovery,
full/compact block retrieval and transaction enhancement. A passing tip read or
metadata preflight covers only a subset of that path.

## Source comparison

| Option                           | Source findings                                                                                                                                                                                                                    | Decision                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing Zallet/Zaino observer   | Patched view-only import exists and ARM build passed. Pinned Zallet has only Zebra and Zaino backends. Current mainnet runtime is not ready.                                                                                       | Preserve the installation and evidence. Do not call it working or keep changing policy without a specific failure.                                                             |
| Zingo CLI / zingolib             | CLI documents UFVK watch-only creation and separate network directories. Key code handles Orchard/Ironwood receivers. Current development CLI bundles a Nym transport and has a broader lifecycle than a headless NOSTOS observer. | Technically relevant, but not a verified drop-in replacement or simply another endpoint URL.                                                                                   |
| ZecLedger                        | Source calls SDK `import_account_ufvk` with `AccountPurpose::ViewOnly`, then standard `sync::run` against hosted lightwalletd. History exposes transaction balance changes and concatenated received memos.                        | Confirms a simpler SDK sync approach exists. Its displayed history is insufficient for exact per-output refund verification; do not substitute it for NOSTOS's matching rules. |
| Direct librustzcash light client | SDK provides lightwalletd gRPC bindings, Ironwood-aware tree/compact-block types, account import and transaction decryption APIs.                                                                                                  | Run a separate compatibility probe before committing to an adapter or changing the VPS.                                                                                        |

ZecLedger's README contains conflicting statements about whether the viewing key
is stored. The account/database code stores it in the wallet database and applies
SQLCipher to connections. Source, not the contradictory prose, governs any reuse.
No ZecLedger code is copied into this probe.

## Concrete isolated test

`scripts/lightclient/probe.rs` is compiled as an example against the same pinned
Zallet core and librustzcash dependency graph already used in the project. It does
not run Zallet, Zaino or the relay. The workflow makes public-chain reads against
two HTTPS endpoints present in ZODL Android's source: zec.rocks and
eu.zec.stardust.rest. TLS verification stays enabled.

The checks cover mainnet identity, a stable mined anchor, actual SDK decoding of
the Ironwood tree into an account birthday, compact-block decoding and agreement
between the tree state's hash and the compact block. A separate unit test uses
public deterministic test material for full/wrong-network/incoming-key decoding.
No real viewing key is supplied. No wallet database, production account, send,
service change or VPS download is included.

A pass establishes only endpoint and SDK decoding compatibility. It does not
prove a merchant import, durable wallet sync, memo intake, outgoing receiver/amount
verification or funded payment/refund. Those remain required before mainnet use.
The workflow is not a decision to replace the existing deployment.

## Merchant signing remains separate

ZODL Android's source changelog records full/incoming viewing-key export and
ZIP-321 support. This does not establish a general application signing API.
The initial merchant flow remains explicit review and approval in the signing
wallet, followed by independent confirmation of the exact receiver, amount, pool
and instruction. No automatic-send claim or operator-signer fallback is allowed.

## Inspected primary sources

- <https://zcash.readthedocs.io/en/latest/rtd_pages/lightclient_support.html>
- <https://zcash.github.io/librustzcash/rustdoc/latest/zcash_client_backend/index.html>
- <https://github.com/zcash/zallet/tree/987382f67e622915228686e9f956c6a9c9a7514c/backends>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_backend/src/proto/service.rs>
- <https://github.com/zcash/librustzcash/blob/1f6bb2072e7fcb142b0d90ff7b267a8699a84818/zcash_client_backend/src/proto/compact_formats.rs>
- <https://github.com/zingolabs/zingolib/blob/d4ac5772d7fc5d4ca621e57523d28f1b24ac24c5/zingo-cli/README.md>
- <https://github.com/zingolabs/zingolib/blob/d4ac5772d7fc5d4ca621e57523d28f1b24ac24c5/zingolib/src/wallet/keys.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/account.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/history.rs>
- <https://github.com/vancube2/zecledger/blob/a933ddae5a6e750a6a80b18bafcceea2c8b0710b/src/wallet/db.rs>
- <https://github.com/zodl-inc/zodl-android/blob/4bef0f470eee7e2df3018fc7158099da17c7c29b/CHANGELOG.md>
- <https://github.com/zodl-inc/zodl-android/blob/4bef0f470eee7e2df3018fc7158099da17c7c29b/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/provider/LightWalletEndpointProvider.kt>
