# ZODL Android operator test

Approved starting checkpoint: `f87acc5acbc2ff6477212aa1b2a3aa4a8103a8eb`.
Branch: `feat/mainnet-wallet-compatibility`. No merge or deployment.

## Current result

The operator initially reported **3.17.1**, a shielded receiving address, **Full**
viewing key export and a Send **Message** field, then updated the app and reported
**3.17.2**. Build number, network, distribution and selected-account type have not
been reported. The controls were reported before the update; account binding
will use the updated app. These are operator observations; Work has no connection
to the phone. Orchard receiver ownership, memo bytes, signing and outgoing
recovery are still unverified. The missing build number does not block the
non-funded, local offline check.

The upstream 3.17.1 release source identifies build **3155**, commit
`85784fd3d8b9e064895a95c9770415c6d6f922c7`, and SDK `5.2.1-SNAPSHOT`. That
build number is not a verified reading from the phone. Comparing it with the
previously reviewed **3.17.2 (3157)**, commit
`cb3fb2236056e0c3e3a6510964257584efb4ebd7`, shows no changes to the app's
export, address, message or signing code. Changes are release notes, app version
and the SDK dependency (`5.2.2-SNAPSHOT`). This does not prove identical SDK or
installed-binary behavior.

The 3.17.2 release fixes Rust-layer server certificate trust, removing revoked
eMudhra roots. The operator now reports that version after an update. Do not
uninstall, restore, create a new account or move funds for this check. Confirm the
same selected account when using the updated app for offline binding; an update
alone cannot close the compatibility gate.

The pinned app implements selected-account FULL UFVK export, distinct from
INCOMING UIVK export, and native software-account proposal review and local
signing. Its ordinary SDK broadcaster uses Sender outgoing recovery by default.
The app declares SDK `5.2.2-SNAPSHOT`; a source-to-installed-binary mapping is
not proved. Hardware accounts, swaps, migrations and send-max are excluded.

## Android: do now, without a transfer

1. With screen recording, casting and remote support off, open ZODL Settings.
   Read the version/build shown there. If absent, use Android Settings, Apps,
   ZODL, App info. Report only version/build, mainnet versus testnet, and
   Store/FOSS/Internal distribution if shown. If build is absent, say so.
2. Select the existing **native software business account**. Keep that same
   account selected throughout. Do not use a Ledger/Keystone account or an
   existing testnet wallet. Open Receive and confirm a unified address is
   available. Do not post the address or a screenshot.
3. Open Advanced Settings, Export viewing key. Check whether **Full** is offered
   separately from Incoming. Report only `Full available: yes/no`. Do not reveal
   or copy a key until the private offline check below is ready. Do not open
   recovery-phrase or spending-key export screens.
4. Confirm Send has recipient, amount and memo entry for that account. Return
   without submitting or approving a proposal. If the UI differs, report the
   missing control in words; do not send wallet screenshots.

These observations identify the device candidate and its UI capabilities. They
do not prove signing, outgoing recovery, Ironwood selection or memo bytes.

## Private offline binding check: no funds or observer import

Use the merchant's own trusted Linux computer, not the VPS, CI or Work terminal.
The separate CI artifact `offline-operator-check-X64` or `-ARM64` contains only
the checker binary, terminal wrapper and public provenance. It is built on
Ubuntu 24.04; check OS/libc compatibility before handling a live key (Mint 22
uses that Ubuntu base; older distributions may need a separate build).

1. Download from a successful compatibility run for the reviewed commit. Match
   `provenance.json`'s NOSTOS commit and both SHA-256 hashes against the CI
   packaging log and reviewed source. An artifact's own checksum alone is not
   independent provenance. Extract into a private directory owned by you.
2. Before revealing a key, disconnect the computer's network and stop terminal
   recording/session capture. Keep encrypted local storage and screen privacy.
   Disable cloud clipboard and keyboard clipboard history on the phone. No
   diagnostic export, log upload or screen recording is part of this test.
3. Run `chmod 700 nostos-operator-check`. Run the binary once with stdin from
   `/dev/null`; it must print a fixed failed boolean report and exit 1. A loader
   error means stop before revealing a key. Do not install software on the VPS.
4. From a local terminal run:

   ```sh
   python3 /absolute/private/path/operator-check.py /absolute/private/path/nostos-operator-check REVIEWED_BINARY_SHA256
   ```

   Replace the final argument with the public hash from the verified CI log.
   Neither argument contains wallet data. Do not use a shell variable,
   redirection, command substitution, environment variable or command argument
   for a viewing key or address.

5. On Android, still in the selected business account, choose **Full**, complete
   the app's private confirmation/biometric flow, and read the export privately.
   Enter it directly at the **hidden** local prompt. Manual transcription is the
   simplest transfer requiring no additional software or cloud channel. Do not
   save it to a file or send it through chat/email. Incoming `uivk1` is rejected;
   the supported ordinary mainnet FULL format starts `uview1`.
6. Return to Receive in the **same selected account**, and enter that displayed
   unified address at the second hidden prompt. The checker validates mainnet,
   canonical encoding, full Orchard viewing access and External receiver scope
   belonging to that key. A normal mixed receive UA is allowed only for this
   binding check; it is not approved as a refund destination. There is no
   transparent/TEX fallback or encoding conversion.
7. Close the export screen. Clear any clipboard entry if copy was used; do not
   create a key screenshot as evidence. Share only the fixed boolean report and
   version/build. On failure, share only `passed: false`; do not paste input or
   error details containing it. One careful retry for transcription is enough;
   persistent failure holds the gate.

The wrapper refuses non-terminal input, disables core dumps, uses hidden prompts
and a private child stdin pipe, discards child stderr and emits only a fixed
boolean schema. The binary has no wallet/database/network/signer calls. It
decodes in memory, writes no key file and imports no account into the observer.
It is not a secure-memory-erasure or protection-against-compromised-host claim.
The operator must keep the computer offline during live-key handling.

`passed: true` proves account binding only. The report deliberately retains
`spending_control_proven: false` and `outgoing_recovery_proven: false`.

## Proposed funded control: separate approval required

Do not execute this section yet. First approve the named local observer host,
private live UFVK import and birthday, read-only provider access, transaction
plan and limits. Confirm isolation (process owner, ports, directories, database,
volumes and resource budget) without changing any recovered testnet service.
Production deployment/mainnet enablement remains a separate decision.

The smallest outgoing proof is **one** ordinary shielded send from the business
account to a second merchant-controlled account with a different key. A send to
the same account can be classified as change and is insufficient. No customer
funds, real refund-route memo, public fixture key or old testnet wallet is used.
The recipient must privately demonstrate its receiver is not in the sender key's
scope. Verify an Orchard-only mainnet UA before generating the payment request.
Before signing, establish that the selected business account has only shielded
spendable funds in the required pool, with no transparent balance or pending
shielding/migration. Use a dedicated account with a verified funding history;
otherwise pause for a private input-selection review. A shielded destination
alone does not prove shielded inputs. Do not sign an opaque cross-pool plan.

| Item                           | Proposed cap                             |
| ------------------------------ | ---------------------------------------- |
| Recipient amount               | 10,000 zatoshis = 0.00010000 ZEC         |
| Control transaction fee        | At most 10,000 zatoshis = 0.00010000 ZEC |
| Maximum business-account debit | 20,000 zatoshis = 0.00020000 ZEC         |
| Additional sends/replacements  | Zero without renewed approval            |
| Confirmation threshold         | At least 3 on the active main chain      |

This amount is a small test budget, not a protocol minimum. ZIP 317's 5,000-zat
marginal fee and two-action grace window explain the proposed simple-transfer
fee allowance. Actual input selection, cross-pool activity or policy can cost
more. Stop if review quotes a higher fee, split/migration, an unexpected pool,
transparent/TEX destination or amount deducted from the recipient amount.

If the business account is empty, propose **one additional shielded funding
payment of 20,000 zatoshis**, with its own fee cap of 10,000. Fresh funding-source
debit is then at most 30,000 zatoshis; the business debit above spends that funded
value, not additional capital. Combined network fees are capped at 20,000
zatoshis. Approve the actual source and both transactions separately. If a
cross-pool transfer cannot fit the cap, return a revised proposal before spending.

Before approval, privately fix the exact account, chain, birthday, recipient,
amount, required output pool, neutral unique control memo and fee cap. Use a
short `nostos:control:` random reference, never a customer return route. Retain
the exact memo bytes privately. The receiver is an Orchard receiver encoding;
the **actual mined output bundle** must prove Ironwood compatibility. An
Orchard-only transfer cannot close the Ironwood gate. Verify actual mainnet
activation; source support or synthetic fixtures do not prove activation.

After approval only, the operator reviews all fields in Android and signs once.
If the send times out or the app closes, keep the attempt unresolved and inspect
the wallet's existing transaction. Do not send again or create a replacement.

## Recovery and reconciliation evidence

After the approved send, collect the txid privately, then close and reopen
Android normally. Do not clear app data or restore the wallet. In the separately
approved isolated observer, sync from the agreed birthday, retrieve the full
transaction and validate network, consensus branch, txid, mined height, block
membership and anchor, and at least three confirmations. A wallet UI status or
explorer screenshot alone is insufficient.

With the sender's exported FULL key, recover the **external outgoing** output
and match exactly the bound sender account, recipient's shielded receiver,
10,000-zat value, selected pool and the saved memo's full padded bytes. Confirm
the transaction spends a note belonging to the business account and contains no
transparent inputs/outputs. Recipient-side incoming recovery corroborates
delivery but cannot substitute for sender-side outgoing recovery. A protocol
transaction does not reveal a conventional public "sender address".

Persist a private reconciliation record keyed by chain, txid, pool and output
index, linked to the immutable approved control attempt. Retain account binding,
height/block hash, confirmations and exact-match results without plaintext
routes/memos in logs. Close and reopen the **isolated local observer**, resync,
and verify the same record/output and memo match, no duplicate settlement and
no second debit. This does not authorize restarting an existing service.

The live control harness, note-spend ownership check and durable instruction to
receipt integration are still remaining work; current offline fixtures prove
decryption/storage behavior, not these live results. Work can verify private
results after an approved implementation and operator run. Do not ask the user
to provide keys or raw decrypted transactions through chat to automate it.

Share a redacted result with version/build, tested commit, booleans for binding,
memo/outgoing match and reopen/retry invariants. Keep real txid/block references
in the private evidence record; publish or paste a txid only with consent since
linking it to the business/control test itself can reveal metadata.

## Specific alternative if the gate fails

Use **merchant-operated Zingo CLI 0.4.0**, tag `zingolib_v7.0.0`, pinned commit
`bfb0a2156819ea7f75a9b09b1724abfd06c8925e`, as the next candidate on the
merchant's own computer. At that pin the CLI exports account-zero UFVK and
birthday, accepts shielded sends with memos, and its transaction constructor
uses `OvkPolicy::Sender`; the source includes Ironwood handling. This keeps
merchant signing and the existing separate observer. No operator custody.

It is a **source-reviewed candidate**, not device/mainnet certified. The release
has no prebuilt assets. A separate isolated build, account-zero binding, full
export compatibility (including encoding revision), private export handling and
the same funded/reopen gate are required before use. Never copy README examples
that place a seed or viewing key in command arguments, and never run recovery
info commands into a shared terminal. A new signing-wallet/account choice and
any migration of real funds require operator approval. If its encoder is not
accepted, do not strip metadata or relax the observer decoder.

## Evidence and next checkpoint

Existing [native CI 39691165545](https://github.com/Olayeniii/Nostos/actions/runs/39691165545)
passed on both ARM64 and x86_64: 20 observer tests, three backup tests and two
broker tests per architecture. These remain synthetic/public-fixture evidence.
This preparation adds a separately packaged offline checker and failure/privacy
boundary tests; it does not integrate an external signer. The reconciliation
contract above is wallet-independent lifecycle preparation.

The checker code at `50e95633e39100716fbd7a5d2dfaa8d88eeb41c9` passed
[native CI 39694509200](https://github.com/Olayeniii/Nostos/actions/runs/39694509200)
on both architectures: 20 observer tests, three binding tests, six terminal
wrapper tests, three backup tests and two broker checks per runner. Both
artifacts are attached to that run. Application
[CI 39694509191](https://github.com/Olayeniii/Nostos/actions/runs/39694509191)
also passed. No live key or funded transaction was involved.

Verified SHA-256 values from the successful packaging logs:

| Artifact                       | `nostos-operator-check` SHA-256                                    |
| ------------------------------ | ------------------------------------------------------------------ |
| `offline-operator-check-X64`   | `7e40eaf56e9254b0efe541183177305a115d05488f7d90b5352f116118514915` |
| `offline-operator-check-ARM64` | `84dba9ee14b2e014cad041012a0ee57d29812ad1efa629bbf6f548301dd1d367` |

The wrapper SHA-256 is identical in both packages:
`f97bfeac2905820ac9b582478629ec63ed9888fa576056973804f024810fd40a`.
These are public artifact hashes, not wallet identifiers. Review this code commit
and match the manifest/log before handling a live export. The guide's later
documentation-only commit does not change the tested artifact code.

Next checkpoint: record the actual Android build/network and native business
account selection, then obtain only the private offline check's boolean result.
Full-export and Message availability are now operator-reported. A material mismatch
holds integration and triggers review of the pinned Zingo candidate. No funded
test, production change, live observer import or mainnet-readiness claim is made.

Primary sources:

- [3.17.1 to 3.17.2 source comparison](https://github.com/zodl-inc/zodl-android/compare/85784fd3d8b9e064895a95c9770415c6d6f922c7...cb3fb2236056e0c3e3a6510964257584efb4ebd7)
- [ZODL release](https://github.com/zodl-inc/zodl-android/releases/tag/3.17.2-3157)
- [Version/build model](https://github.com/zodl-inc/zodl-android/blob/cb3fb2236056e0c3e3a6510964257584efb4ebd7/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/model/VersionInfo.kt)
- [Selected-account export](https://github.com/zodl-inc/zodl-android/blob/cb3fb2236056e0c3e3a6510964257584efb4ebd7/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/usecase/GetVKUseCase.kt)
- [FULL/INCOMING mapping](https://github.com/zodl-inc/zodl-android/blob/cb3fb2236056e0c3e3a6510964257584efb4ebd7/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/model/AccountExt.kt)
- [Local selected-account signing](https://github.com/zodl-inc/zodl-android/blob/cb3fb2236056e0c3e3a6510964257584efb4ebd7/ui-lib/src/main/java/co/electriccoin/zcash/ui/common/repository/ZashiProposalRepository.kt)
- [Pinned Android SDK](https://github.com/zodl-inc/zodl-android-wallet-sdk/tree/828874217a22bbf6ab7df4ea59b59f295d059ff4)
- [ZIP 317](https://zips.z.cash/zip-0317)
- [Zingo version](https://github.com/zingolabs/zingolib/blob/bfb0a2156819ea7f75a9b09b1724abfd06c8925e/zingo-cli/Cargo.toml)
- [Zingo export](https://github.com/zingolabs/zingolib/blob/bfb0a2156819ea7f75a9b09b1724abfd06c8925e/zingo-cli/src/commands.rs)
- [Zingo Sender policy](https://github.com/zingolabs/zingolib/blob/bfb0a2156819ea7f75a9b09b1724abfd06c8925e/zingolib/src/wallet/send.rs)
