# Build and deployment status

Checkpoint: 26 October 2026. Source and deployment are separate facts.

| Area                        | Verified checkpoint                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source                      | PR #8 merged into `main` at `8d86d59b3be4dde7c4a742d02205ebceadaa75e2`                                                                                                         |
| Private mainnet web preview | Operator reported healthy installation of `b201c4c1205f73cd5fd5f43981f95d1489fe3a8d`, whose source tree matches the merge                                                      |
| Normal observer policy      | Operator reported normal worker restored and temporary exception removed                                                                                                       |
| Data and health             | Existing records preserved; sign-in HTTP 200; anonymous account endpoint HTTP 401; installation requested zero sends                                                           |
| Mainnet payment             | Operator confirmed 100,000 zats, or 0.001 ZEC                                                                                                                                  |
| Mainnet partial refund      | Chain lookup returned five confirmations for the submitted transaction; the operator subsequently confirmed ZODL and NOSTOS showed confirmation for 50,000 zats, or 0.0005 ZEC |
| Public deployment           | Equality with the reviewed mainnet preview has not been established                                                                                                            |

## Validation

The PR #8 source checkpoint passed 435 application tests, 17 Node tests, three final-preview deployment tests, TypeScript, targeted lint, the current-file secret scan and the Next.js production build. Native verification source was restored to its previously tested version. Native tests and optimized builds were also run by the operator on the isolated ARM64 build host during the mainnet work.

These are recorded checkpoints, not a claim that a later checkout has just rerun every test. Fixture checks do not establish a new funded transaction. The deployment report is supplied operator evidence, not direct remote access by the reviewer.

## Submission work remaining

- Verify the public deployment and intended judge access path.
- Prepare the demo video using the existing confirmed records; no additional funded test is required for that recording.
- Complete submission fields and save the submission receipt.
- Review source visibility and licensing before public release. The repository is currently private and `UNLICENSED`.
- Resolve the retained dependency-security branch separately before treating the deployed dependency stack as security-updated. That work is not part of the merged payment/refund release.

The earlier testnet evidence remains in `scripts/evidence`. It is historical evidence, with its original network and limits.
