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

The first Oracle ARM64 deployment of the new account product and a new controlled payment through a compatible customer wallet remain unverified.
