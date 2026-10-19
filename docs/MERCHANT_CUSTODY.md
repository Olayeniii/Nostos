# Merchant-controlled wallets

Decision recorded on 19 October 2026: merchants should retain their own wallet
signing keys and recovery material. A separate account inside the operator's
Zallet is hosted custody and does not meet that requirement.

## Current checkpoint

The existing testnet hosted-custody demonstration remains available, including
the proved manual payment and partial refund. Its existing records and encrypted
routes are retained. Item21's failed old refund instruction remains blocked.

The operator reports that the hosted mainnet metadata probe and authenticated
loopback relay check passed, broadcasts remain disabled, and a new mainnet wallet
was initialized with its mnemonic backup confirmed. No wallet service startup,
complete database/identity backup, merchant account, funds or sync proof has been
reported for that new wallet. It is operator-controlled. Keep it unfunded and
stopped; do not reuse or delete its keys while custody work proceeds.

Application entry points now reject hosted merchant setup, payment request
creation, payment instruction preparation, refunds and withdrawals on mainnet
before wallet calls or state changes. The server gate has no environment bypass.
The mainnet setup page explains the pending wallet connection and disables its
hosted-account action. This is a release hold, not a completed merchant-wallet
integration. The relay can still supply public chain reads.

## Selected integration to build and prove

1. The merchant creates and backs up a dedicated business wallet in their own
   wallet application. NOSTOS never requests the recovery phrase, spending key,
   wallet encryption identity or a copy of a signing wallet database.
2. The merchant explicitly grants NOSTOS view access to that dedicated account.
   An Orchard-capable unified full viewing key permits receiving/payment memo
   checks and outgoing refund verification without spending authority. The
   wallet's network, birthday and supported shielded pools must be checked.
3. The observer derives or verifies merchant receiving addresses belonging to
   that viewing account. A pasted receiving address alone cannot verify an
   encrypted payment memo or prove ownership of the signing keys.
4. Customer payments go directly to the merchant wallet with the exact expected
   NOSTOS memo and the return route supplied with that payment. Customers remain
   accountless. Orchard-only refund policy remains mandatory.
5. Refund approval presents the exact immutable instruction for the merchant to
   review in their own signing wallet. Start with explicit manual approval if a
   wallet handoff API is unavailable. A click, signature request, user-supplied
   txid or broadcast acknowledgement is not confirmation. Verify the outgoing
   receiver, amount, pool and confirmation independently in the observer, and
   prevent one transaction from satisfying multiple refund instructions.
6. Pending or unknown refunds retain their reservation and routes; timeouts do
   not permit a second send. Watch-only adapters must never fall back to an
   operator signer. Existing hosted records must not be silently converted.

Full viewing keys reveal sensitive account activity and memo data even though
they cannot spend. Explain this access before import, encrypt the application
copy, exclude keys from diagnostics and URLs, and review observer storage, logs,
WAL/SHM and backups. Removing a key in the UI is not proof that historical copies
are erased. Use a dedicated business account instead of a personal-wallet key.

Funds are already in the merchant wallet in this model. Transfers to another
wallet are authorized there. NOSTOS can display refund obligations and fee
shortfalls, but cannot force an independently controlled wallet to retain a
reserve. Do not describe an accounting reserve as a spending lock on that wallet.

## Verified dependency gap

The pinned Zallet v0.1.0-beta.3 `z_importviewingkey` accepts only Sapling extended
full viewing keys. It cannot import the Orchard unified viewing key required by
this plan. Its Rust database dependency has `import_account_ufvk`, but that does
not make the capability available through this RPC. Adding the supported RPC or
using another observer is required before connection can ship. No database file
injection or Sapling/transparent refund fallback is permitted.

Zodl Android release notes describe viewing-key export, making it a candidate
merchant wallet. Installed-version support, actual key export, Orchard/Ironwood
compatibility, the observer import and independent outgoing refund visibility
must all be proved. Do not claim that viewing-key export also proves signing or
handoff support. No merchant wallet connection is implemented at this checkpoint.

Sources inspected:

- <https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/import_viewing_key.rs>
- <https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/pczt_inspect.rs>
- <https://github.com/zodl-inc/zodl-android/releases>
- <https://github.com/NoirWallet/zcash-wallet-adapter/blob/main/README.md>

## Release proof

Before removing the mainnet hold, prove receiving with the exact encrypted memo,
refund signing in a merchant-controlled wallet, independently confirmed outgoing
refund, fee/unknown-outcome handling, and merchant recovery. Demonstrate that the
observer has no spending authority, review key/log/backup retention, and preserve
network isolation. Any funded transaction requires separate explicit merchant
authorization. Current tests and operator relay metadata are not this proof.
