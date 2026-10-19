# Orchard observer candidate

`zallet-ufvk.patch` extends Zallet v0.1.0-beta.3 at commit
`987382f67e622915228686e9f956c6a9c9a7514c` without replacing the legacy Sapling
import path. It is a source candidate until the dedicated Rust workflow passes.
No installed binary, wallet directory or service is changed by this repository.

The extension handles Orchard UFVK inputs to `z_importviewingkey` only with an
explicit positive birthday and `whenkeyisnew`. It decodes the full key against the
wallet's network, rejects incoming-only and Sapling-only keys, rejects observers
containing spending accounts, imports with `AccountPurpose::ViewOnly` and returns
a deterministic Orchard-only address plus account UUID and the extension marker
`nostos_view_only_v1: true`. Repeating the same import reuses that view-only account.
It never accepts or calls a seed, spending-key, signing or broadcast API.

Key parsing and errors do not emit key text. The operator still needs a separately
initialized observer without any merchant spending keys or mnemonic-derived
accounts. The existing operator/testnet wallets must never be repurposed. A wallet
that attests view-only status is still inside the operator trust boundary, not an
independent cryptographic proof of custody or signing-wallet ownership.

The workflow checks out the pinned source, applies the patch and compiles/tests
it. It does not deploy, initialize a wallet, import a real key or request a send.
A separate isolated Zaino backend build and runtime import/sync proof are required
before any VPS installation or funded proof. Keep the mainnet release hold.
