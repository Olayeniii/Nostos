# Web verification and phone runbook

Historical verification record. Current product and deployment instructions are linked below.

## Trusted origins

Refund POST accepts the exact origins `http://127.0.0.1:3000` and `http://localhost:3000` by default. Optional `NOSTOS_WEB_TRUSTED_ORIGINS` replaces this list with comma-separated exact origins. An empty value denies every origin. HTTP entries are accepted only for loopback hosts; other entries require HTTPS. Request URL, Host, and forwarded headers do not grant trust.

Authentication and `NOSTOS_WEB_ALLOWED_PAYMENT_TXID` remain required. Keep Next bound to loopback. The deployed phone path now uses Nginx HTTPS at `https://nostos.iyforge.xyz`, with `NOSTOS_WEB_TRUSTED_ORIGINS=https://nostos.iyforge.xyz`. Port 80 serves ACME validation and HTTPS redirects only. Existing bearer authentication and payment authorization remain required.

## Request behavior

Payment reads expire after 12 seconds, including response body reading. One read runs at a time. Changing access or beginning a send cancels the old read; obsolete reads cannot update the screen. Existing saved payment data remains visible after a connection failure.

Refund POST expires after 130 seconds, beyond the wallet adapter's existing 120-second deadline. Browser cancellation does not cancel the server operation. A submitted payment is blocked in memory until a saved refund state resolves it. A fresh read that still says refundable does not authorize another send. No automatic resend is implemented. Server persistence and one-instruction-per-payment rules remain the authority across reloads.

Review and submission use the same exact integer zatoshi amount and payment ID. Decimal input is parsed without floating point multiplication. The send guard rechecks that input still matches the reviewed instruction.

## Current deployment path

The earlier shared-mount build/restart procedure is superseded. Use the checked
isolated-release automatic deployment in [AUTO_DEPLOY.md](AUTO_DEPLOY.md).
Do not restart the healthy web container to load a build. A candidate must pass
its checks and health probe before traffic switches; the prior release remains
available for rollback. Do not restart wallets or Zebra.

The checks below are historical evidence from the earlier single-payment UI,
not current acceptance instructions. For the current product review and real
Item21 evidence, use [DEMO.md](DEMO.md) and
[TIGHTENING_PASS.md](TIGHTENING_PASS.md).

## Controlled phone checks before another payment

1. Open `https://nostos.iyforge.xyz`. Enter access privately. SSH forwarding is no longer required.
2. Load records and select `ui-order-001`. Check that the saved refund is 0.0031 ZEC and sending is unavailable. Do not send another refund for this order.
3. Refresh repeatedly. Check that saved status stays visible and only one request is pending. Interrupt the tunnel and confirm that the connection warning blocks actions without erasing saved data. Restore the tunnel and refresh.
4. Review an eligible new payment only after the failure checks pass. Record entered ZEC, displayed reviewed ZEC, submitted integer zatoshi, refund database amount, and customer received amount. These must agree before marking exact-amount proof passed.
5. A send interruption requires reconciliation. Do not retry merely because a request failed or the screen reloaded.

## G5 status

Controlled user-operated Android Chrome flow passed on deployed commit da15c77a7080a5e4a37827570ea5cc93a5080bdd. ui-order-002 review showed 0.003 ZEC; database stored 300000 zatoshi, confirmed, retry_count 0; customer wallet reported value 0.003, valueZat 300000, five confirmations. Merchant details and customer receipt agreed, with 0.007 ZEC remaining and another send unavailable. Refund txid: 6b954c9f9732a834bba95715172054baa8f6beb86d6f101fd01b6c51efde0741.

Screenshots supplied in the conversation: 1002586124.jpg (review), 1002586125.jpg (broadcast), 1002586126.jpg (merchant confirmed), 1002586127.jpg (customer receipt). Screenshot binaries are not bundled in the repository. This is user-operated proof, not an agent-operated browser test. Logo appeared beside broadcast status; animation timing is not proven by a still image. Stale/overlapping refresh stress tests and interrupted-send reconciliation remain G6 work.

The phone already showed a real confirmed refund for ui-order-001. Its intended amount was 0.003 ZEC, but database and customer receipt showed 310000 zatoshi (0.0031 ZEC). The retry input is uncertain. The discrepancy is unresolved and is not an exact-amount pass. G1, G3, and G4 evidence remains unchanged.

The user noticed and removed an extra keyboard digit during ui-order-002 input before review. This makes accidental input plausible for ui-order-001 but does not establish its prior submitted amount.

## HTTPS operations

Nginx configuration: `/etc/nginx/conf.d/nostos.conf`. Certificate: `/etc/letsencrypt/live/nostos.iyforge.xyz/`. Certbot reported scheduled renewal. Keep the ACME webroot `/var/www/nostos-acme` reachable on port 80. VPS INPUT contained an earlier REJECT before UFW; only TCP 80 and 443 were allowed before it. A dedicated `nostos-web-firewall.service` was provided for reboot persistence; enabled state and reboot behavior still require verification. Do not flush or replace firewall tables.

Private Docker replacement configuration files under `~/nostos/` contain credentials. Do not commit or share them. Previous stopped web containers are rollback copies. No wallet, Zebra, koko-memory, or disk guard restart was required for this migration.
