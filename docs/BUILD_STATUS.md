# Project status

Updated 26 October 2026.

## Mainnet

NOSTOS is live at <https://nostos.iyforge.xyz>. The completed mainnet test paid 100,000 zats (0.001 ZEC) and returned 50,000 zats (0.0005 ZEC) as a confirmed partial refund. Both the wallet and NOSTOS showed the refund confirmation. Network fees are separate.

The original confirmed payment/refund release is `b201c4c1205f73cd5fd5f43981f95d1489fe3a8d`, with the same source tree as the payment/refund merge in PR #8. Public mainnet routing was added in PR #11. The public installation passed HTTP health checks, preserved existing records and left the observer unchanged. The normal observer policy is installed.

The current web release is `2eb75f89a7beb6fc7db010c6f34c2b1e4846a722` from PR #14. It adds the Store header label and generated paper background to the unpaid request and portrait desktop layout features from PR #13. Installation checks returned public HTTP 200 and anonymous account HTTP 401, with mainnet settings, existing records, observer and routing preserved. No sends were requested. PR #12 added the earlier workspace update, documentation cleanup and MIT license.

## Validation

The payment/refund release passed 435 application tests, 17 Node tests, three deployment tests, TypeScript, targeted lint, the current-file secret scan and the Next.js production build. Native tests and optimized builds ran on the isolated ARM64 build host.

The request and layout update passed 64 targeted application tests, three deployment tests, TypeScript, targeted lint and formatting, the production JS build and 52 browser fixture states. The final portrait CSS was applied to the built application during browser verification. These checks are separate from the completed mainnet transaction test.

The Store surface update passed the production build, TypeScript, targeted lint and formatting, three deployment tests and local HTTP checks for the header and background asset. Browser visual verification was unavailable for this update.

The retained dependency-security branch has not been included in the deployed payment/refund release. Historical testnet evidence remains in `scripts/evidence` with its original network and scope.
