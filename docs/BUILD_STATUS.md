# Build status

| Gate              | Status         | Required proof                                                           |
| ----------------- | -------------- | ------------------------------------------------------------------------ |
| G0 Foundation     | Passed locally | Install and all repository checks pass.                                  |
| G1 Shielded spike | Passed         | Real payment, memo recovery, refund, and receipt references.             |
| G2 Domain         | Passed         | Domain and schema tests pass.                                            |
| G3 Payment intake | Passed         | One real payment appears once after scanner restart.                     |
| G4 Refund core    | Passed         | One partial refund broadcasts once and confirms.                         |
| G5 Interface      | Passed controlled phone flow | HTTPS review, 300000 zatoshi refund, confirmed wallet note, and both phone views agree. |
| G6 Hardening      | Not started    | Privacy and failure tests pass.                                          |
| G7 Submission     | Not started    | Deployed product, evidence, repository, and video.                       |

No simulated result may be labeled as real.

G5 proof is user-operated Android Chrome plus pasted VPS database and customer wallet outputs. See `scripts/evidence/gate-g5.json`. Browser stress tests, interrupted-send reconciliation, and loading animation timing remain for G6. The ui-order-001 amount discrepancy remains unresolved.
