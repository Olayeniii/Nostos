# Merchant interface review

Source baseline: `c6940481ca238a1458176069a0135c0b8e4c9d5c` in `Olayeniii/Nostos`.

## Scope and findings

The source audit covered the merchant dashboard, funds, settings, checkout,
receipts, account forms and shared shell, together with current custody,
refund, authentication and funds documentation. Historical UI docs are marked
as superseded and were not treated as current setup instructions.

Live public entry and sign-in screens were inspected in the browser. The browser
has no signed-in merchant session, so no production merchant record was accessed.
No live payment, refund, withdrawal, registration or wallet action was performed.

The stylesheet contains several layers of ledger rules. A later 760px minimum
width and fixed column sizes conflict with phone layouts. The desktop selected
layout compresses those same columns beside a detail panel. Small status labels
share almost identical treatment, and metric cards lack a clear first priority.
Controlled baseline fixtures did not reproduce document-level horizontal overflow at the six tested widths. They did show stacked unlabelled phone status chips and a clipped desktop ledger beside details. The responsive changes address these observed issues; the external audit is not treated as proof of an additional live defect.

Copy feedback previously reused the error channel. Remaining refundable payment
value is accounting and must not be presented as spendable wallet funds.

## Visual system

The existing mark, Manrope, Plex Mono, dark green, ivory and mint remain.
The received total is the ivory focal surface, with smaller refund totals on
one dark surface. Ledger rows sit on a quiet canvas. The curved return seam
on the total and empty state is derived from the existing return-route motif.
Mint identifies primary actions and completed lifecycle steps. Amber indicates
waiting, gray expiry, rose failure/unknown outcomes and blue confirmed refunds.
Every color is accompanied by text. Shared helper and footer text is larger.
Controls keep a 44px minimum height. Color transitions respect reduced motion.

## Workflow changes

- Mobile summaries stack and long values can shrink within the grid.
- Phone payment cards prioritize order and amount, with labeled secondary states.
- Mobile selection replaces the workspace with a dedicated detail view.
  Focus moves into details, Back restores the selected row, and Escape closes
  details when no action is busy.
- Desktop keeps ledger columns. Selecting a row uses a compact list beside details.
- Details separate payment, fulfillment and refund, show reserved and remaining
  values, and list recorded refund instructions.
- Payment-link sharing uses a prominent copy button, separate feedback, a bounded
  QR code and an ellipsized read-only link. Opening the link panel leaves details.
- Funds explains the distinction between available value and the exact fee quote,
  and spells out the review sequence before any send.
- Receipt copy does not assert an available refund when eligibility is absent.
- Unloaded totals show placeholders rather than implying a zero balance.

No API projection, wallet RPC, authentication, persistence, refund reservation,
mainnet hold, route fallback or transaction submission semantics changed.

## Verification

`node scripts/ui/merchant-visual.mjs before` and `after` use synthetic API
responses in an isolated browser. Every unhandled mutation is rejected. Reviewing
a refund is checked to create no refund submission. The screenshots are visual
fixtures, not live wallet evidence or a new payment proof.

The PR workflow checks 320, 375, 390, 430, 768 and 1440px, captures baseline and
updated payment, details, review, link, funds, checkout, receipt, registration,
empty, loading and error screens, and rejects document overflow in the updated
screens. Baseline comes from the PR base SHA in a separate worktree. Images and
JSON results are uploaded as the `merchant-ui-review` Actions artifact.

Local Chromium launch is blocked by a socket restriction in the work environment.
The Actions browser run succeeded and its merchant, details, sharing, funds and
receipt screenshots were visually reviewed. The review led to darker receipt
helper text and a clearer available-funds row. Final evidence is linked in the PR.
Production authenticated behavior and an actual phone check remain separate from
the fixture suite.

Local validation: 313 unit/integration tests and 57 Python tests passed. Lint,
TypeScript, source build, Next production build and secret scan passed. CI and
screenshot results are recorded in the PR.

No merge or deployment is authorized by this review.
