# Private loopback review

The review web build is pinned to `e42d718ea53a0b270d9948b2b90ac6498685e42a`. The operator reported successful ARM64 build, tests and exit code zero in its separate builder. The Python preparation helper is separate deployment tooling and does not require rebuilding the web application.

`prepare-private-review.py` requires sudo only to read existing protected node/mail configuration and write fresh preview files with the intended runtime user ownership. It does not start or stop services, replace files or change existing permissions. It checks the revision marker, build output, native worker hash, private directories/cookies, mainnet chain metadata and available loopback ports before writing. An existing runtime directory is refused, including after a partial preparation. Never delete that directory or rotate its key to retry without checking its state.

The helper creates a new `runtime` directory inside the private review directory, containing separate product database storage, a fresh data encryption key, a private credential copy, a narrowly selected mail configuration and the observer launcher configuration. No existing product data, hosted signer configuration or signing-wallet mount is inherited. The native observer uses the already authorized isolated SDK installation. Existing testnet wallets and application services stay outside this procedure.

Only these new preview processes may be started afterward:

1. The installed SDK broker, under the original operator user, using `runtime/observer-config.json` and loopback port 38235. Keep its log outside the protected wallet state directory.
2. A new named web container using the existing Node image, the reviewed source read-only, `runtime/data` at `/preview`, `runtime/rpc` read-only at `/preview-rpc` and `runtime/web.env`. Bind Next only to `127.0.0.1:3108`. Do not publish a public Docker port, edit nginx, reuse production environment wholesale or rename the production container.

The PC connects to VPS loopback port 3108 through its existing SSH identity and opens `http://localhost:3108`. Both the trusted origin and mainnet account-link origin are pinned to that exact PC origin. The browser's existing Secure, HttpOnly and SameSite cookie requirements are not relaxed. If the intended browser refuses localhost session cookies, use a reviewed HTTPS solution instead of weakening those settings. Open verification emails on the same PC while its tunnel is active.

Create a separate review login through the normal verified-email flow. Do not copy production sessions or mark a fabricated account verified. The imported operator wallet is not silently adopted by the product merchant. Connecting the dedicated business account still requires its actual viewing key, password, saved birthday and explicit scope consent through the product form. The preparation report includes only the saved numeric birthday to aid that step, not the key or account identifier.

This preview can observe and check existing saved evidence, but mainnet payment creation, hosted signing and public refund handoff remain disabled. Record-check enablement is limited to the separate preview. No fixture balances or transactions are presented as live chain evidence.

Local preparation tests cover distinct storage/origin settings, no signer inheritance, unexpected settings and newline rejection, fresh encryption keys, private file permissions, no overwrite, no symlink acceptance and wrong-revision refusal. The complete Python web suite passes. These tests use synthetic configuration only. VPS startup, real mail delivery and browser acceptance remain separate operator checks.
