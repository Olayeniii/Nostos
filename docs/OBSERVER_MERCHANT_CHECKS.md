# Merchant observer checks

The existing business-wallet connection panel can now request a live SDK sync check. It reports the chain tip and fully scanned height, distinguishes a caught-up observer from a pending scan, and leaves payment creation and signing disabled. Readiness is a point-in-time observation, not a persisted release approval. Missing view access, unsupported scope, malformed fields, unavailable RPC and unexpected chain context cannot report readiness. The API returns only a selected status summary, never the key, account identifier or raw provider response.

The existing merchant payment details can optionally show checks for an existing incoming payment transaction and a saved outgoing refund instruction. A transaction reference is only a candidate. The server derives the exact expected output fields from saved records, invokes the native verifier and then applies its durable journal and receipt projection. Caller-supplied receivers, amounts, memos, merchant identifiers and arbitrary refund txids are rejected. A refund check cannot create a plan, claim a wallet handoff, bind a replacement txid, sign or broadcast.

These record checks are off by default. Enable `NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS=yes` only on a separate reviewed SDK preview deployment already configured for mainnet and observer-preview mode. Both the authenticated API and dashboard feature advertisement enforce this setting. This flag allows verified updates to existing preview ledger records; it does not allow new mainnet checkout preparation or funded signing. Mainnet observer screens disable the existing hosted send controls. Existing testnet operation is preserved.

- `GET /api/product/wallet-status` requests fresh readiness for the authenticated merchant's bound SDK namespace.
- `POST /api/product/observer-payment-check` accepts only checkout ID, candidate txid and Orchard-family pool.
- `POST /api/product/observer-refund-check` accepts only a saved refund request ID. Its instruction and txid must already exist.

All record-check writes require the existing session and origin checks, verified merchant email, ownership and a bounded merchant-specific request rate. Failed or timed-out verification does not authorize another send. Existing saved records remain available through the private receipt projection. No public release or native package changes are included here.

The test observer imported through the private operator procedure has its own isolated namespace. It is not automatically adopted by a product merchant, nor does this change silently copy its viewing key into the product database. Product connection still requires its own authenticated merchant flow, key binding, birthday and scope consent. The private procedure's saved birthday must be retained if that account is later connected under a separately reviewed procedure.

Funded outgoing recovery, wallet approval and the full product cycle remain unproved. The public funded route stays held until those checks and review are complete. The new UI uses existing panel/form styles; approved dashboard and receipt styling is unchanged.

Operator-reported progress on October 23: private view-key import, sync and normal reopen passed with payments disabled. An age-encrypted observer backup was created on the VPS, copied to the operator PC, checked against its expected SHA-256 and restored there with database integrity checks. This proves the supplied backup could be decrypted and restored by Python; a native SDK open of that restored PC copy has not been performed. No funded transaction was reported. The backup does not include product records, the operator import journal or the signing wallet's recovery phrase.

## Local validation

All 381 application tests, formatting, lint, TypeScript, source build, secret scan and Next production build passed. `scripts/web/observer-ui-smoke.mjs` checks the production UI at phone and desktop sizes with synthetic browser API responses. It covers readiness failure clearing, exact candidate fields, duplicate-click prevention, proof failure messaging, the disabled record-check flag, testnet wallet copy and phone overflow. No funded or physical-wallet evidence is implied.

Run the browser check against a local production server with Playwright available. `NOSTOS_UI_BASE_URL` defaults to `http://127.0.0.1:3107`. An external Playwright module can be selected with `NOSTOS_PLAYWRIGHT_MODULE`; `NOSTOS_CHROMIUM_PATH` optionally selects an installed Chromium executable. This test intercepts product API requests and uses no real account or wallet.

## Account links in an isolated preview

Mainnet requires `NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN` for verification, password-reset and email-change links. It must be a single exact HTTPS origin, or an explicit HTTP loopback origin, also listed in `NOSTOS_WEB_TRUSTED_ORIGINS`. Paths, fragments, credentials, external HTTP and origins absent from that allowlist are rejected before mail delivery. Request and forwarded headers never select the account-link destination. The existing testnet production default remains unchanged when no override is set.

For a private PC browser review through SSH, set both values to `http://localhost:3108` and bind the server only to the VPS loopback interface. The email link is opened on that same PC while the tunnel is active. It does not expose a public preview or support opening the localhost link on a different device. Existing Secure, HttpOnly and SameSite session-cookie settings remain intact. Build containers receive no mail key, wallet, cookie or production database mounts. Separate preview credentials and data must be prepared before runtime startup.

The origin fix passed all 396 application tests, formatting, lint, type checking, source build, secret scan and the local Next production build. The operator reported that the earlier preview source built successfully on ARM64 in its separate review container. The new account-link fix requires an incremental rebuild before that preview starts. It does not change the native worker package.
