# Project status

Updated 26 October 2026.

## Mainnet

NOSTOS is live at <https://nostos.iyforge.xyz>. The completed mainnet test paid 100,000 zats (0.001 ZEC) and returned 50,000 zats (0.0005 ZEC) as a confirmed partial refund. Both the wallet and NOSTOS showed the refund confirmation. Network fees are separate.

The deployed payment/refund source is `b201c4c1205f73cd5fd5f43981f95d1489fe3a8d`, with the same source tree as the payment/refund merge in PR #8. Public mainnet routing was added in PR #11. The public installation passed HTTP health checks, preserved existing records and left the observer unchanged. The normal observer policy is installed.

The workspace layout update in PR #12 is installed at revision `217010b97b2898138dbdf563278e39656c8328db`. Installation checks returned public HTTP 200 and anonymous account HTTP 401, with mainnet settings, existing records, observer and routing preserved. No sends were requested. The later documentation and license changes do not require another web installation.

## Validation

The payment/refund release passed 435 application tests, 17 Node tests, three deployment tests, TypeScript, targeted lint, the current-file secret scan and the Next.js production build. Native tests and optimized builds ran on the isolated ARM64 build host.

The workspace layout update passed the production build, TypeScript, targeted lint and formatting, 48 responsive fixture states and three deployment tests. These fixture results are separate from the completed mainnet transaction test.

The retained dependency-security branch has not been included in the deployed payment/refund release. Historical testnet evidence remains in `scripts/evidence` with its original network and scope.
