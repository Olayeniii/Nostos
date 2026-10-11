# Build status

| Gate              | Status                       | Required proof                                                                                                |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| G0 Foundation     | Passed locally               | Install and all repository checks pass.                                                                       |
| G1 Shielded spike | Passed                       | Real payment, memo recovery, refund, and receipt references.                                                  |
| G2 Domain         | Passed                       | Domain and schema tests pass.                                                                                 |
| G3 Payment intake | Passed                       | One real payment appears once after scanner restart.                                                          |
| G4 Refund core    | Passed                       | One partial refund broadcasts once and confirms.                                                              |
| G5 Interface      | Passed controlled phone flow | HTTPS review, 300000 zatoshi refund, confirmed wallet note, and both phone views agree.                       |
| G6 Hardening      | Passed scoped checks         | 82 tests pass; browser product flow, uncertain-send blocking, private storage and deployment rollback checks. |
| G7 Submission     | In progress                  | Deploy the product update, verify the real merchant flow, then prepare repository and video.                  |

No simulated result may be labeled as real.

G5 proof is user-operated Android Chrome plus pasted VPS database and customer wallet outputs. See `scripts/evidence/gate-g5.json`. The earlier `ui-order-001` amount discrepancy remains unresolved and is not used as exact-amount proof. The controlled `ui-order-002` flow confirmed exactly 300000 zatoshi.

G6 includes local mobile and desktop Chromium checks over real account, setup, checkout, receipt and refund interfaces with a mock wallet adapter. No new chain transaction was broadcast for that browser test. It does not replace G5's real wallet evidence. See `scripts/evidence/product-accounts-ui.json`.

The earlier claim that the first Oracle ARM64 product deployment was unverified
is superseded by the operator's
subsequent healthy-release reports and the authenticated merchant/receipt review
recorded in `docs/DEMO.md`. Latest GitHub main independently checked on October 11:
`cc43ab69eb1d34bb4f695ee4c7cd8801141d7acc`. Exact current deployment equality remains
unverified; no deployment or restart was performed during this check.

## Current submission evidence

The original Item21 payment and 0.018 ZEC partial refund are confirmed in supplied
merchant evidence and the existing receipt. The customer explicitly reported
receiving the refund in Noir. This was a manually entered payment, not a completed
automatic handoff. Its remaining 0.002 ZEC and original unset deadline explain why
both protected return-route copies remain.

Desktop Noir reached approval after the connection fix, but the separate
transaction failed consensus validation with an incorrect branch ID. Resync did
not resolve that rejection on October 11. Automatic payment completion is blocked;
mobile automatic handoff remains unproved. See `docs/DEMO.md` for scoped evidence
and remaining checks. Historical gate counts are not the current test count.

On October 11, `pnpm check` passed: format, lint, typecheck, all 232 tests across
26 files, TypeScript build and current-file secret scan (164 files). Seven Python
deployment/auto-deployment tests also passed. After the evidence update, format
and diff checks passed again and the secret scan passed across 165 files. These
are local repository checks,
not current live deletion, deployment equality or wallet interoperability proof.
