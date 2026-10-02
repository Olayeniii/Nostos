# Build status

| Gate              | Status         | Required proof                                                           |
| ----------------- | -------------- | ------------------------------------------------------------------------ |
| G0 Foundation     | Passed locally | Install and all repository checks pass.                                  |
| G1 Shielded spike | Passed         | Real payment, memo recovery, refund, and receipt references.             |
| G2 Domain         | Passed         | Domain and schema tests pass.                                            |
| G3 Payment intake | Passed         | One real payment appears once after scanner restart.                     |
| G4 Refund core    | Passed         | One partial refund broadcasts once and confirms.                         |
| G5 Interface      | Passed controlled phone flow | HTTPS review, 300000 zatoshi refund, confirmed wallet note, and both phone views agree. |
| G6 Hardening      | Passed scoped checks | 60 tests pass; mocked lost-response reconciliation, phone recovery/refresh, and HTTPS renewal checks pass. |
| G7 Submission     | Not started    | Deployed product, evidence, repository, and video.                       |

No simulated result may be labeled as real.

G5 proof is user-operated Android Chrome plus pasted VPS database and customer wallet outputs. See `scripts/evidence/gate-g5.json`. Browser stress tests, interrupted-send reconciliation, and loading animation timing remain for G6. The ui-order-001 amount discrepancy remains unresolved.

G6 completion is scoped to automated privacy/failure checks and user-reported phone/VPS checks. Lost-response validation uses the browser request helper with an isolated mock wallet, not a rendered browser transaction. Animation timing, instrumented browser concurrency, and firewall reboot behavior are not claimed. See `scripts/evidence/gate-g6.json`.
