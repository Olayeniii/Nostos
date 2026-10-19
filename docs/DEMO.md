# NOSTOS demo and evidence

NOSTOS lets a payer supply a shielded refund route with the original payment,
allowing the merchant to issue a later shielded refund without asking for another
address. The merchant decides whether a refund is due. Customers stay accountless
and can request a refund from their existing private receipt.

## Show the result first

Open the existing Item21 private receipt privately. Show the original 0.02 ZEC
payment, the confirmed 0.018 ZEC refund and the remaining 0.002 ZEC payment value.
Then show the matching merchant record. Explain that the refund used the route
supplied in the original payment memo. Neither view needs the return address.
Do not send another payment or refund to repeat this proof.

The historical fulfillment state was not independently established. Do not claim
Item21 was marked failed or that a customer request caused its refund. Explain a
fulfillment failure as a supported reason to refund, separately from this observed
transaction. Do not change its history for a recording.

## Demonstrate the product controls

On the merchant payment detail, explain payment confirmation, merchant-reported
fulfillment and refund status separately. A fulfillment failure never sends funds
automatically. The refund form supports full remaining value or a partial amount,
then requires review and an explicit send. Customer refund requests have separate
approval/decline decisions. A request is not automatic authorization to spend.

Show controls without submitting another operation on Item21. For a future live
judge transaction, use a genuine merchant payment request and an explicitly
approved testnet payment. Preserve the memo and Orchard-only return-route policy.
The customer keeps the same private receipt throughout. Unknown send outcomes
must be reconciled before another send. Never substitute staged database records.

## Evidence boundaries

| Claim                   | Evidence and limit                                                                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real shielded payment   | Operator supplied matched merchant wallet note/memo evidence for Item21; expected NOSTOS v1/order and canonical Orchard-only route matched. Incoming note pool was Ironwood.                                                                                                |
| Real partial refund     | Read-only database checkpoint records a confirmed 1,800,000 zat refund, zero retries and the transaction below. The operator also observed confirmation on the private receipt.                                                                                             |
| Customer received funds | Customer explicitly confirmed Noir received the refund after reimport/sync on October 6. The attached screenshot was not independently read by the agent.                                                                                                                   |
| Automatic handoff       | Desktop Noir 1.0.38 reached transaction approval after the connection fix. The separate payment failed consensus validation and its receipt remained unpaid. Automatic payment completion and mobile handoff remain unproved. Item21 used manual address/amount/memo entry. |
| Current storage         | Operator read-only inspection reported two protected product routes and one protected core address, with zero unprotected/invalid values. This scope excludes logs, wallet history, WAL and backups.                                                                        |
| Retention               | Item21 has an original unset deadline and remaining refundable value. Both protected routes are retained. New requests have finite windows; live full-refund/expiry retirement remains unproved.                                                                            |
| Custody                 | Hosted merchant Zallet holds spending authority. The application coordinates merchant-authorized spending; Zallet constructs/signs/broadcasts. Merchant-controlled custody is not implemented.                                                                              |
| Route meaning           | A route supplied with this payment. No proof of payer identity, receiver control or ongoing possession is claimed. Authenticated Reply Addresses is draft prior art, not an implemented standard.                                                                           |

Payment transaction:
`6f692f8c99d355f9a1d3ddf99a76df1cdaf3f81bbc07a14db7d460c838f9c91e`

Refund transaction:
`ad7ff94e16ba2793d2831166d9dcfe6ebaf045856db2aa56808db55134965272`

Transaction IDs alone do not publicly prove shielded amounts or recipients.
The [machine-readable checkpoint](../scripts/evidence/item21-refund.json)
records evidence provenance. Do not publish receipt capabilities, customer routes,
wallet memos, account emails, credentials or keys with the demo.

## UI review on October 6, 2026

GitHub main reviewed: `d93409ec8fbdd0e030abf414c305bdb6fab11a05`.
Local source snapshot: `b5cc1c2`. The working tree was clean before this pass.
The live desktop homepage, signup and sign-in were visually reviewed. The homepage shows
pay/fulfill/refund and the signup shows email first, verification before password.
The sign-in screen has a password-eye toggle and separate recovery/verification links. No account was created. No wallet or production data was changed during review.

Dashboard/receipt behavior was reviewed in source. Dashboard totals were corrected
to count confirmed incoming payments separately from detected/unconfirmed value,
and count confirmed refunds only when a refund occurred. Refund review explains
the supplied route without displaying its masked fingerprint.

After secure merchant sign-in, the live JaraBot dashboard and Item21 detail were
reviewed. They showed 0.02 ZEC received, 0.018 ZEC refunded and 0.002 ZEC available,
with merchant-reported fulfillment still pending. The existing payment link led
to a confirmed checkout with only a receipt action. The same private receipt
showed the confirmed partial refund, remaining value, original unset deadline
and a refund-request form requiring no new address. No request, refund or
fulfillment change was submitted. Private capabilities were omitted from output.

The live dashboard still displayed the older summary wording at observation
time; the newly pushed UI change is not yet live-verified. Mobile CSS breakpoints
exist, but this browser exposes no viewport resize capability; source inspection
is not mobile rendering proof. Exact live release/main equality is unknown from
this browser. The last operator-provided release was
`19fded2b2fec-1791315685`; do not label it current after later auto-deploys.

Before the final recording: visually review the merchant detail and existing
receipt on the actual phone, check pending/error states without submitting a new
transaction, and confirm the fresh isolated candidate is healthy. Keep public
landing copy and evidence distinct from claims about deployed code. Final video
length and submission fields must be checked against the organizer's current
requirements before publishing; this document does not invent those requirements.

## Subsequent deployment and phone evidence

The operator reported `nostos-web` running release
`5158586eca56-1791319512`, with local sign-in HTTP 200. This matches the pushed
`5158586eca561a5f28fdab8083b67baf28053fd3` snapshot at that checkpoint, not any
later revision. The phone screenshots independently show the updated dashboard
wording and refund-capability explanation.

The supplied Android screenshots cover merchant totals, Item21 detail,
fulfillment/refund controls, receipt payment/refund amounts, expanded transaction
references and the customer refund-request form. In those views amounts are
readable, references wrap and no horizontal clipping is visible. They establish
appearance in this phone/browser, not every viewport or successful form
submission. The original payment is confirmed, 0.018 ZEC is confirmed refunded
and 0.002 ZEC remains. No return address is displayed in these views.

The follow-up polish replaces the fixed `0.003` refund placeholder with
“Enter refund amount” and reduces mobile fulfillment/control spacing while
keeping 44-pixel action targets. This candidate still needs deployed visual
confirmation. It changes no refund authorization, retry rules, payment state or
stored route. Real automatic Noir handoff remains unproved.

On October 7, the desktop Noir 1.0.38 test opened Connect but did not reach
transaction approval. A separate read-only `zcash_getAccounts` check subsequently
returned an authorized shielded testnet account, while the payment button still
reopened Connect. The handoff now reads existing authorization first and requests
Connect only when that lookup returns null. Lookup errors and unsuitable accounts
stop before spending. Regression tests cover both connection paths; real approval,
broadcast and receipt of this separate test payment still require live verification.

## Desktop handoff checkpoint, October 11

The customer reported a real testnet approval screen on October 7 after the
connection fix. A separate mainnet extension window also opened; this is not
proof of two testnet sends. The customer approved the testnet request only.
The wallet subsequently reported an incorrect consensus branch ID and later
marked the activity failed. The associated NOSTOS receipt remained awaiting
payment. Wallet-reported transaction reference:
`52c7722b889f955971b29730a94a8ac0633f8a623d978d054668b8a756e14445`.
This reference is not independent chain evidence.

On October 11, the customer reported incomplete spendability metadata, ran
resync, then reported the same consensus branch rejection again. Neither the
wallet builder's actual branch ID nor the server's accepted branch was obtained.
Do not assign the fault conclusively to either component or claim resync fixed it.
Public server probes were blocked by HTTP 403 or browser CORS; those failures
provide no branch metadata. Do not repeat those probes as a recovery step.

The manual Item21 payment/refund evidence remains valid. Record the direct Noir
path as approval observed, payment completion blocked. Do not submit another
payment or substitute a staged result for this failed attempt. A maintainer
comparison of the signed transaction and current testnet validation rules is
needed to identify that mismatch. Any other wallet must satisfy the same memo
and Orchard return-route rules before a separate test is proposed.

## Remaining submission checks

- Confirm the current deployed SHA from the running release, independently of
  GitHub main. The October 6 release observation is historical.
- Inspect current route columns and the retention worker on the deployed release.
  Item21 has remaining refund value and no original deadline; preserve its route.
- Verify deletion on a genuinely eligible full-refund or expired record if one
  already exists. If none exists, report local coverage and leave live deletion
  unproved. Never alter Item21 or create a transaction to manufacture that proof.
- Complete the separately scoped wallet history, WAL, backup and full repository
  history review before claiming all sensitive material is removed or publishing
  the repository. Current-column encryption is narrower evidence.
- Record the existing receipt and merchant views privately, redact capabilities,
  and keep the supported fulfillment-failure explanation separate from Item21's
  actual pending fulfillment history.

## 19 October reconciliation gate

The operator supplied a fully synced wallet and matching-account history containing
only the known payment and confirmed partial refund, plus a block anchor beyond
the unknown attempt's standard validity window. The guarded Item21 recovery is
prepared in source; deployment and operator apply output are still required. See
[CLOSEOUT.md](CLOSEOUT.md). Until that output is captured, say “0.018 ZEC confirmed
refunded; 0.002 ZEC reserved under an unresolved attempt.” After verified apply,
say “0.018 ZEC confirmed refunded; the unsuccessful 0.002 ZEC attempt was closed
after reconciliation, without sending another transaction.” Never describe the
full 0.02 ZEC as refunded. Keep private receipts, routes and wallet data out of the
recording.
