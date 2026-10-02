# Product interface and private receipt access

This replaces the shared demo role switch. It does not restart the project or change the shielded payment/refund core.

## Routes

| Route       | Purpose                                             | Access                            |
| ----------- | --------------------------------------------------- | --------------------------------- |
| `/`         | Product entry                                       | Public shell, no payment records. |
| `/merchant` | Merchant payment list, amount review, refund status | Secure merchant session.          |
| `/receipt`  | Customer status for one payment                     | Separate private receipt link.    |
| `/404-test` | Example missing route                               | Branded 404, HTTP 404.            |

Testnet labels remain. Historical order references and earlier evidence remain unchanged. Product controls contain no demo, build or gate labels.

## Merchant workflow

1. Sign in with the separate merchant password. The server sets a secure HTTP-only cookie for up to eight hours. The backend API token never enters the browser.
2. Select a payment and match the order reference to the merchant's order records.
3. Decide whether a refund is owed under the merchant's policy. NOSTOS does not resolve disputes or prove a customer claim merely because they hold a receipt link.
4. Review the exact amount and masked return route before sending.
5. Copy the customer receipt link and share it privately with that customer.

The current `NOSTOS_WEB_ALLOWED_PAYMENT_TXID` safeguard stays in place. One refund instruction per payment remains the supported behavior. No additional refund is permitted for ui-order-001 or ui-order-002.

## Receipt access boundary

`NOSTOS_RECEIPT_SECRET` is a separate 32-byte key encoded as 64 lowercase hex characters. It stays on the VPS. HMAC-SHA256 derives an opaque, payment-scoped bearer token with a domain separator. Merchant access can issue the link only through an authenticated request from a trusted origin.

The token appears in the link fragment, not the query or path. The fragment is not sent in ordinary HTTP navigation. The client sends the token only in the receipt API Authorization header. No third-party analytics or browser storage is added. Referrer policy is `no-referrer`.

A customer receipt response contains only the selected order reference, payment amount/confirmation count, refund amount, refund status and refund txid when available. It contains no destination, merchant account, payment list or refund permission. Receipt access cannot authenticate merchant APIs, create another receipt link or send a refund. The merchant password, API token and session cannot open customer receipts.

Anyone holding a receipt link can read that receipt. Links do not expire in this version. Rotating the server receipt key revokes all existing receipt links; per-link revocation and customer accounts are outside this version. The same key must survive web container replacements.

Customer confirmation uses the existing exact destination, amount and incoming-output checks inside the trusted service. A receipt is not marked confirmed merely because a transaction is visible.

## VPS setup

After pulling and building this revision, run:

```bash
python3 scripts/web/enable-receipts.py
```

The helper reads the existing Docker configuration privately, creates a dedicated receipt key if needed, stores it at `~/nostos/receipt-access.key` with mode 0600, and preserves the merchant token, payment authorization, trusted origins, mounts, user, image and host networking. On first setup it also prompts privately for a separate merchant password, saves only its salted scrypt hash in the container configuration, and recreates only `nostos-web` when adding configuration, keeps the previous container as a stopped configuration rollback copy, and checks the sign in page after each start or restart. Existing configured keys are preserved; subsequent runs restart the web container to load the built revision. No wallet operation is performed. Configuration rollback does not restore a previous build in a shared source mount.

Do not print, commit or share the receipt key. The helper does not change Nginx, wallet services, Zebra, koko-memory or the disk guard. HTTPS and the existing trusted origin setting remain required.

## Verification

- 74 automated tests passed, including seven receipt-boundary checks.
- Repository formatting, lint, type check, source build and secret scan passed.
- Next production build passed.
- Local production HTTP checks passed for entry, merchant, receipt, custom 404, response privacy headers and receipt/merchant access isolation.
- VPS helper was checked with fake Docker responses and a temporary home directory: original settings preserved, key mode 0600, stable key reuse. It has not been executed on the VPS by the agent.
- Phone rendering, copying a real receipt link and opening that link require deployment verification.

No new payment or refund was broadcast for this change. Existing G1, G3, G4, G5 and scoped G6 evidence is preserved.

## Merchant sign in and UI review

- `/sign-in` is separate from `/merchant`. Eight-hour signed cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Strict. No login credential is saved in browser storage or sent to merchant APIs as a bearer token.
- The separate password hash uses scrypt with N=16384, r=8, p=1. Password or backend token rotation invalidates all existing sessions. Signing out clears the current browser cookie; copied cookies remain valid until expiry or credential rotation.
- Sign in and sign out require the configured trusted Origin. Merchant refund and receipt issuance preserve their existing authentication, Origin and payment restrictions.
- The single-process sign in budget permits at most ten attempts per minute across all clients and resets on restart. This is a bounded single-instance control, not a distributed account system.
- Settings is a separate authenticated, read-only page. It exposes no RPC URL, wallet identity, credential or raw refund destination.
- UI review used Anthropic's frontend-design skill and Vercel's web-design-guidelines and React guidance from their official GitHub repositories. The locked NOSTOS specs override generic styling preferences.
- Payment rows have readable status text, a selected marker, and disabled state during send. Mobile selection scrolls and focuses the detail panel; the compact list remains available above it. A summary replaces the always-visible global ready strip.
- Task motion keeps the ivory mark complete with a 950 ms mint route loop, delayed by 250 ms. Written broadcast and uncertain states stop motion. Reduced motion is static.
- Local production HTTP checks passed for sign in, protected settings, cookie flags, Origin rejection, payment authorization and customer receipt isolation. No database or wallet operation was performed.
- The sign in/password setup helper passed fake Docker checks for original settings, key permissions, separate password hash and later restart. Real VPS and phone verification remain pending. The local browser executable is unavailable, so no visual browser proof is claimed.

## Remaining product limits

The customer receipt is now a separate read-only surface. A customer browser payment composer and independent wallet integration are still unimplemented. The entry page has no unproven Pay action. The existing CLI customer payment path remains the tested transaction source. Removing demo copy does not turn this into production custody or a general wallet.
