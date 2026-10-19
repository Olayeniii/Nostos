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

## Build a separate binary on the wallet host

After the pinned-source Rust workflow passes, the normal `ubuntu` user can run:

```bash
cd ~/nostos/repo
git pull --ff-only origin main
python3 scripts/observer/build.py
python3 scripts/observer/build.py --build
```

The first command prints build prerequisites without writes. The explicit build
uses a new directory under `~/nostos/observer-builds`, verifies the pinned commit
and exact patched file hash, and builds Zaino with two parallel jobs. It requires
Cargo/Rust compatible with the pinned source and at least 12 GiB free disk before
starting; actual compiler memory/disk demand can be higher. A failed or interrupted
build preserves its source directory. It cannot overwrite the existing wallet
binary, create a wallet, change services or send a transaction. This host build
still needs to pass on ARM; the Rust workflow's x86 build is a separate check.

Share only the final build metadata or compiler error. After the isolated build,
prepare a separate view-only observer directory/service, with no mnemonic,
merchant spending keys or fallback to the operator wallet. Do not start it by
reusing either existing wallet service or the initialized operator mainnet wallet.

Validation on 19 October: the pinned Rust workflow passed compilation and its
Orchard full/incoming/wrong-network/Sapling key checks. Application commit
`e141bdb339ec7dbbc89a2005a33fc189ac32ef52` passed GitHub production CI with
311 application tests and 31 web deployment/inspection Python tests. The local
isolated-builder suite also passed four safety tests. None of these results
proves an ARM build or live observer import/sync.
