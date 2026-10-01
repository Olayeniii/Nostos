# Web verification and phone runbook

Continue from main 5bc257b998bc07daab123286c98cb3be7bc0ff33. No wallet, node, scanner, or refund-core changes are needed for this patch.

## Trusted origins

Refund POST accepts the exact origins `http://127.0.0.1:3000` and `http://localhost:3000` by default. Optional `NOSTOS_WEB_TRUSTED_ORIGINS` replaces this list with comma-separated exact origins. An empty value denies every origin. HTTP entries are accepted only for loopback hosts; other entries require HTTPS. Request URL, Host, and forwarded headers do not grant trust.

Authentication and `NOSTOS_WEB_ALLOWED_PAYMENT_TXID` remain required. This policy does not make the application public. Keep Next bound to loopback, and use the existing SSH tunnel.

## Request behavior

Payment reads expire after 12 seconds, including response body reading. One read runs at a time. Changing access or beginning a send cancels the old read; obsolete reads cannot update the screen. Existing saved payment data remains visible after a connection failure.

Refund POST expires after 130 seconds, beyond the wallet adapter's existing 120-second deadline. Browser cancellation does not cancel the server operation. A submitted payment is blocked in memory until a saved refund state resolves it. A fresh read that still says refundable does not authorize another send. No automatic resend is implemented. Server persistence and one-instruction-per-payment rules remain the authority across reloads.

Review and submission use the same exact integer zatoshi amount and payment ID. Decimal input is parsed without floating point multiplication. The send guard rechecks that input still matches the reviewed instruction.

## VPS update

Run in Termius. This preserves the existing web container configuration and credentials. The rebuild uses the same Node image and pnpm version as the previous successful deployment.

```bash
cd ~/nostos/repo && git pull --ff-only origin main && docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e NEXT_TELEMETRY_DISABLED=1 -v "$PWD:/app" -w /app node:24-bookworm-slim sh -c 'npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 --filter @nostos/web build' && docker restart nostos-web
```

Do not recreate the wallet services, Zebra, koko-memory, or disk guard. No new token or wallet identity is required. If an existing origin environment override is present, it must include the chosen tunnel origin; defaults apply only when that variable is absent.

## Controlled phone checks before another payment

1. Open `http://127.0.0.1:3000` through the existing Termius tunnel. Enter access privately.
2. Load records and select `ui-order-001`. Check that the saved refund is 0.0031 ZEC and sending is unavailable. Do not send another refund for this order.
3. Refresh repeatedly. Check that saved status stays visible and only one request is pending. Interrupt the tunnel and confirm that the connection warning blocks actions without erasing saved data. Restore the tunnel and refresh.
4. Review an eligible new payment only after the failure checks pass. Record entered ZEC, displayed reviewed ZEC, submitted integer zatoshi, refund database amount, and customer received amount. These must agree before marking exact-amount proof passed.
5. A send interruption requires reconciliation. Do not retry merely because a request failed or the screen reloaded.

## G5 status

Incomplete. Automated helper and HTTP boundary tests pass. Production build passes. Controlled browser rendering, amount submission, overlapping/stale refresh handling, and loading animation still require browser verification. This environment's browser blocked loopback access; no browser test pass is claimed.

The phone already showed a real confirmed refund for ui-order-001. Its intended amount was 0.003 ZEC, but database and customer receipt showed 310000 zatoshi (0.0031 ZEC). The retry input is uncertain. The discrepancy is unresolved and is not an exact-amount pass. G1, G3, and G4 evidence remains unchanged.
