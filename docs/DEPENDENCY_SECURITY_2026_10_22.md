# Dependency security checkpoint, 22 October 2026

Branch: `fix/dependency-security-oct22`, based on
`d19d04e03517eb55367151f5638d2675963a9cdc` of the wallet compatibility branch.
Main, the original compatibility branch and the pending staging branch are not
updated by this work. No live service, wallet, key, volume, port or funds are
changed. This is source and CI work, with no deployment approval.

## Application and build tools

The initial pnpm audit metadata reported three critical, three high, six moderate
and one low finding. The updated complete application/development dependency
graph reports zero advisories. This is an advisory-database result, not a claim
that the software is free of defects.

| Dependency                | Previous                                 | Prepared version               |
| ------------------------- | ---------------------------------------- | ------------------------------ |
| Node, tested release line | Workspace 24.19.0; live image unverified | 24.22.1 minimum within Node 24 |
| pnpm                      | 11.25.0                                  | 11.28.7                        |
| Next.js                   | 16.3.8                                   | 16.4.2                         |
| React / React DOM         | 19.3.0                                   | 19.3.1                         |
| Vitest                    | 3.2.4                                    | 4.1.12                         |
| typescript-eslint         | 8.44.1                                   | 8.72.0                         |
| ESLint / @eslint/js       | 9.36.0                                   | 9.39.5                         |
| Vite                      | 7.3.6                                    | 7.3.7, explicit override       |
| source-map-js             | 1.2.1                                    | 1.2.2, explicit override       |

Updating Vitest removes the old vulnerable tinypool path. Updating the TypeScript
lint dependency removes the old braces path. Overrides prevent peer/dependency
reuse from retaining the vulnerable Vite and source-map-js versions. No audit
exclusions are added. CI now runs the complete pnpm audit and fails on any
reported severity. ESLint 9 is still marked deprecated by npm; upgrading its
major release is separate compatibility work, not a reported vulnerability fix.

Node's 21 October release addresses TLS/CA trust, DNS, Brotli and other issues.
The repository requires patched Node 24 and matching pnpm. CI uses 24.22.1. A
runtime guard runs before a future web build installs dependencies, and before
the SDK broker reads configuration or opens credentials/storage/ports. The
deployer still inherits the existing image: an old image fails the guard and
cannot produce a new release. It is not automatically replaced. An operator must
approve any actual image/runtime update and web switch separately.

## Selected SDK observer and offline checker

The wallet SDK remains pinned at
`987382f67e622915228686e9f956c6a9c9a7514c`. Wallet, consensus, signing and note
cryptography dependencies are not upgraded as part of the transport changes.

| Transport crate | Previous | Exact security version |
| --------------- | -------- | ---------------------- |
| h2              | 0.4.15   | 0.4.16                 |
| rustls          | 0.23.41  | 0.23.46                |
| rustls-webpki   | 0.103.13 | 0.103.16               |
| webpki-roots    | 1.0.8    | 1.0.10                 |

Crate archive bytes were checked against the crates.io SHA-256 metadata. The
preparation helper permits only those version/checksum changes, rejects unknown
sources/checksums/duplicates and validates both lockfiles before writing either.
All other package fields remain equal. Cargo must accept the prepared graph
with `--locked`; compilation and native tests are required before artifact use.

The selected SDK lock inventory contains 585 registry package/version pairs.
After these updates OSV reports zero vulnerability findings and four upstream
informational notices: atomic-polyfill and basic-toml are unmaintained, and git2
0.20.4 has two unsoundness notices. The report retains these names and IDs. The
audit does not certify their call paths or audit the pinned Git source code.
Replacing those upstream dependencies needs its own SDK compatibility review.

The audit fails on vulnerability findings, missing/paginated results, network
failure or inconsistent package metadata. Informational notices are reported
separately according to RustSec's classification; there is no advisory-ID ignore
list. Tests prove that an informational notice cannot hide another vulnerability.
Artifact provenance records the exact transport versions, policy hash and
prepared-lock hash. The SDK artifact verifier requires these fields and the new
Node guard file. Earlier artifacts are superseded for new operator testing.

## Legacy prototype and live infrastructure limits

The older Zallet/Zaino backend lock has additional findings outside the selected
SDK graph: five quinn-proto 0.11.15 vulnerability entries, old webpki-root-certs
1.0.8 and a rand 0.7.3 advisory alias, plus informational notices. The combined
731-package inventory is not called clean. These legacy prototype artifacts are
not approved for the mainnet signer or observer path. This source update does
not rebuild, install, migrate or patch either recovered testnet wallet or Zebra.

Host OS libraries, CA packages, installed wallet binaries and the actual live
Node image have not been inspected or patched by this checkpoint. Their update
requires a separate read-only inventory and operator-approved change window.
Passing package audits does not prove current deployment versions or funded
mainnet behavior. Existing isolation and payment/refund approval gates remain.

## Validation

Local checks use a separately downloaded Node 24.22.1 runtime, verified against
the official SHA-256 manifest, and isolated pnpm 11.28.7 verified against its npm
integrity value. No global/laptop/VPS runtime was replaced.

Application checks passed 327 tests, lint, formatting, type checking and build;
the Next.js production build also passed. Targeted tests cover exact transport
changes and refusal before private configuration access on an old Node runtime.
Native ARM64/x86_64 rebuilds and updated artifact hashes must be recorded before
resuming the operator key-binding test. The first local packaging check caught
a dynamic-test import/fixture mismatch introduced by the new policy module; the
test loader and synthetic lock were updated, with artifact integrity checks
retained and the new transport fields verified.

No real viewing key, seed, spending key, transaction or sensitive memo is used.
No funded payment/refund or persistent live receipt is claimed.

Primary references:

- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nextjs.org/blog/nextjs-security-update-october-14-2026
- https://github.com/advisories/GHSA-5xrq-8626-4rwp
- https://github.com/advisories/GHSA-5gmw-xhrv-c9v3
- https://github.com/advisories/GHSA-85c8-ppgw-ccpr
- https://github.com/advisories/GHSA-qxg6-89mg-rqv8
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q
- https://rustsec.org/advisories/RUSTSEC-2026-0258.html
- https://rustsec.org/advisories/RUSTSEC-2026-0285.html
- https://rustsec.org/advisories/RUSTSEC-2026-0346.html
- https://rustsec.org/advisories/RUSTSEC-2026-0348.html
- https://rustsec.org/advisories/RUSTSEC-2026-0349.html
- https://rustsec.org/advisories/RUSTSEC-2026-0381.html
- https://rustsec.org/advisories/RUSTSEC-2026-0382.html
- https://rustsec.org/advisories/RUSTSEC-2026-0383.html
