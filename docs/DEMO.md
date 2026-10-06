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

| Claim                   | Evidence and limit                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real shielded payment   | Operator supplied matched merchant wallet note/memo evidence for Item21; expected NOSTOS v1/order and canonical Orchard-only route matched. Incoming note pool was Ironwood.                                          |
| Real partial refund     | Read-only database checkpoint records a confirmed 1,800,000 zat refund, zero retries and the transaction below. The operator also observed confirmation on the private receipt.                                       |
| Customer received funds | Customer explicitly confirmed Noir received the refund after reimport/sync on October 6. The attached screenshot was not independently read by the agent.                                                             |
| Automatic handoff       | New injected Noir extension path has synthetic-provider regression coverage. Real extension execution, shielded funding enforcement and mobile handoff remain unproved. Item21 used manual address/amount/memo entry. |
| Current storage         | Operator read-only inspection reported two protected product routes and one protected core address, with zero unprotected/invalid values. This scope excludes logs, wallet history, WAL and backups.                  |
| Retention               | Item21 has an original unset deadline and remaining refundable value. Both protected routes are retained. New requests have finite windows; live full-refund/expiry retirement remains unproved.                      |
| Custody                 | Hosted merchant Zallet holds spending authority. The application coordinates merchant-authorized spending; Zallet constructs/signs/broadcasts. Merchant-controlled custody is not implemented.                        |
| Route meaning           | A route supplied with this payment. No proof of payer identity, receiver control or ongoing possession is claimed. Authenticated Reply Addresses is draft prior art, not an implemented standard.                     |

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
