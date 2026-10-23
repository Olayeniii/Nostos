# Local ARM64 package build

This path replaces hosted CI for building the observer package. It does not install the package, start a service, import a wallet or lift the mainnet hold.

Use an Ubuntu 24.04 ARM64 build host with enough disk and memory for the pinned SDK release build. The builder uses two compile jobs. Keep it separate from live wallets and the running release. Dependencies must already be available: Git, Rust 1.95.0 through rustup, clang/libclang, pkg-config, OpenSSL development libraries, protobuf compiler, age/age-keygen, Node and Python 3.11 or later. The script does not install system dependencies. Cargo may fetch locked dependencies over the network.

Start from a clean Nostos checkout at the reviewed feature commit and a clean Zallet checkout at `987382f67e622915228686e9f956c6a9c9a7514c`. Both paths are local inputs. The upstream checkout is cloned into a new private workspace; the originals are not edited.

Example, after checking out the reviewed source in a separate build directory:

```sh
python3 /path/to/Nostos/scripts/lightclient/build-local-arm64.py \
  --source /path/to/Nostos \
  --upstream /path/to/zallet \
  --workspace /path/to/new-observer-build \
  --revision REVIEWED_FULL_COMMIT_SHA
```

Replace every example path and the revision. The workspace must not exist and must be outside both checkouts. Do not point the inputs at the running release or wallet directories.

The script rejects another CPU/OS, dirty checkouts and wrong revisions. It prepares the pinned native sources, runs backup and broker tests, runs release native fixtures, builds the worker and checks linkage. Only successful checks produce the fixed-file package. The final ZIP is inspected without executing or extracting it. The final line reports the package path, SHA-256 and source revision. Preserve those alongside the build log.

Local provenance explicitly records `build_origin: local` and `workflow_run_id: null`. It never claims a GitHub run occurred. The checksum establishes integrity against the separately retained value, not independent trust in the build host. Existing GitHub packages remain compatible with the inspector.

Current evidence: packaging tests use a synthetic ELF header, including rejection of x64 input and acceptance of explicit local provenance. The local builder host and source checks are tested. A real ARM64 release build has not been run for this source on the current x64 workspace. The previous native fixture tests and x64 worker build remain separate evidence. Do not install older artifacts as if they contained the new output verifier.

After building, isolated installation and the approved private funded wallet checks still remain. Public mainnet payment creation and hosted spending stay disabled throughout this build.
