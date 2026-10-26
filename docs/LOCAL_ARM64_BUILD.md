# ARM64 observer builds

The native observer is built separately from the web application. Builds never install a service, import a wallet or authorize spending.

Use a private Ubuntu 24.04 ARM64 build host with sufficient disk and memory. Required tools include Rust 1.95.0 through rustup, Git, clang/libclang, pkg-config, OpenSSL development libraries, protobuf compiler, age/age-keygen, Node and Python 3.11 or later. The builder uses two compile jobs and locked dependencies.

Start from clean, reviewed NOSTOS source and a clean Zallet checkout at `987382f67e622915228686e9f956c6a9c9a7514c`. The builder clones the upstream into a new workspace; it does not edit the inputs.

```sh
python3 /path/to/Nostos/scripts/lightclient/build-local-arm64.py \
  --source /path/to/Nostos \
  --upstream /path/to/zallet \
  --workspace /path/to/new-observer-build \
  --revision REVIEWED_FULL_COMMIT_SHA
```

Use a nonexistent workspace outside both source checkouts and all live wallet/release directories. The script checks host architecture, source revisions and cleanliness, prepares pinned modules, runs native/backup/broker checks and builds the worker before packaging. Failed workspaces remain available for inspection.

Local artifacts record local build origin rather than a fabricated workflow run. Verify the package's source revision, platform, fixed file list, permissions and SHA-256 against independently retained build output before installation. `inspect-sdk-package.py` reads packages without executing them.

The mainnet release has successful ARM64 builds with recorded source revisions and binary hashes. New native source needs a fresh build. Unchanged source can reuse a previously verified artifact. Deployment remains separate; see [deployment](AUTO_DEPLOY.md).
