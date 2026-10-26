# Legacy Zallet/Zaino observer

This directory retains the earlier Orchard UFVK extension and its build/inspection tooling. The selected mainnet backend is the [SDK observer](../lightclient/README.md), not this Zaino executable. No migration or backend switch is implied by retaining these files.

`zallet-ufvk.patch` extends the pinned Zallet source at `987382f67e622915228686e9f956c6a9c9a7514c`. It imports supported full viewing keys as view-only accounts with an explicit birthday, preserves the legacy Sapling path and rejects spending-account observers. `zaino-transport.patch` records the earlier public-chain transport changes.

`build.py` checks prerequisites and can explicitly build a separate binary. `package-arm64.py` records fixed-file provenance; `verify-artifact.py` validates archive paths, checksums, revision and ARM64 architecture without executing the binary. Source patches and successful builds do not establish a working deployment.

These tools must not overwrite the selected SDK worker, replace a live wallet or reuse existing signing-wallet directories. Historical build and runtime details remain in Git history. Current setup and trust boundaries are in the [documentation index](../../docs/README.md).
