# Merchant workspace: checkpoint 2

Overview and Refunds now have real routes. The shared forest rail and phone menu
link Overview, Payments, Refunds, Funds, and Settings, with the current screen
marked. Sign out is in the header so five phone destinations remain usable.

Overview derives received totals, fulfillment work, refund review work, and
processing refunds from the existing dashboard response. It explicitly separates
payment history totals from wallet funds. Refunds lists only recorded requests
and refund activity, with review / processing / history filters. Active or unknown
refund events take priority over older settled record status. No route validity
is inferred from a confirmed payment. All review links open the existing payment
details, where existing availability checks and send guards remain in force.

Funds and Settings use the same workspace and light surfaces. Their action
handlers, validation, password requirements, refund reserves, review step, and
confirmation behavior are unchanged. Customer-facing screens remain for the next
checkpoint. No backend or production changes are included.

Validation includes the existing workflows plus the new routes, current-menu
state, links to payment details, refund processing filters, and empty / loading /
error states at six widths. Only two new images are requested: a desktop Overview
and phone Refunds viewport. Captures reset scroll position and use viewport bounds
to show the fixed rail or bottom menu accurately. Further checks should disable
screenshots unless visual evidence of a defect requires a focused capture.

The previous checkpoint reports follow as historical context.

---

# Approved direction: checkpoint 1

This checkpoint replaces the Payments presentation with the second approved concept:
a narrow forest rail, warm paper canvas, editorial headings, flat transaction rows,
and a vertical payment lifecycle in the desktop inspector. The existing NOSTOS
mark and real application states remain. Phone layouts use a compact list and
fixed bottom menu. Search and All / Awaiting / Confirmed filters operate on the
loaded merchant records. No wallet, refund, auth, or backend behavior changes.

Scope is the shared workspace component and Payments only. Funds, Settings,
Overview, Refunds, and customer-facing refinements remain for later checkpoints.
Links point only to existing screens; no placeholder destinations are presented.

The initial browser job saved exactly two images (run 39518231585): 390px Payments and 1440px payment
details. The existing baseline is retained in previous PR artifacts; it is not
recaptured. Visual review caught an inherited grid rule in the phone totals; the
metrics now explicitly stack their labels, amounts, and helper text. Follow-up
verification runs with screenshots disabled to preserve the two-image budget.
Layout and workflow assertions still run at 320, 375, 390, 430, 768,
and 1440px, including populated, empty, loading, error, and detail states. Search,
filter reset, refund review, and unavailable-route guards are checked without
sending a payment, refund, or withdrawal. Browser data is explicitly fixture data.

The previous checkpoint report follows as historical context.

---

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
- Phone and tablet payment cards prioritize order and amount, with labeled secondary states.
- Phone and tablet selection replaces the workspace with a dedicated detail view.
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
empty, loading and error screens, and rejects document overflow and compact-ledger horizontal scrolling in the updated
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
