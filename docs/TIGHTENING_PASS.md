# Commerce and verified merchant access

Starting upstream main: `5a87ff46de821c884ceec876d406406bf73a0129`. Last completed live release reported by the operator: `8b29aa4c940e`; automatic deployment of `5a87ff4` was building when this pass started. A build-start message is not deployment proof.

## Preserved privacy and refund boundaries

Expected NOSTOS memo parsing, canonical Orchard-only receiver validation, no transparent/TEX/Sapling refund fallback, wallet RPC loopback/credential/redirect restrictions, sanitized errors, encrypted product/core route storage, receipt capabilities, immutable refund keys and cumulative remaining-value accounting already existed. They remain in place. Partial refunds retain capability; confirmed full repayment or the snapshotted expiry removes current route copies, while open requests or unresolved sends delay removal. Wallet memo history, backups and SQLite remnants have separate retention properties. Removal is not cryptographic erasure.

The operator previously checked the Item21 route and memo against browser/API responses, application and proxy logs. No match was reported in that scope. This pass does not turn that earlier scoped check into a claim about all logs or repository history. No production data was purged or fabricated. A new read-only `inspect-route-storage.mjs` authenticates encryption of route/memo columns and reports counts only. Run inside the deployed container after rollout:

```bash
sudo docker exec nostos-web node /app/scripts/web/inspect-route-storage.mjs
```

Any unprotected/invalid value is a blocker requiring inspection before a targeted migration. Do not blindly delete or rewrite legacy records. Current source fixtures use synthetic route values; the private repository's complete historical secrets review remains open before publication.

## Email ownership

Existing merchants are migrated to an unverified state, never grandfathered as email owners. Registration sends verification without a session. Verification is required for the authenticated merchant product, including setup, payment links, refunds and fulfillment actions. Customers remain accountless and existing private receipt links continue to work.

Tokens are random 32-byte capabilities, stored only as keyed hashes with encrypted email and a 30-minute expiry. They are single-use and previous tokens of the same purpose are invalidated on resend. Per-email and global durable limits restrict mail requests. Unknown addresses get the same eligibility message. Completion chooses a password and invalidates all prior account sessions and account links. This also prevents pre-registration of somebody else's email from leaving the registrant's password active. Password recovery sends only to a verified email. A new email needs current-password authorization and a token delivered to the new address; the old email remains active until completion. No token or password is logged or stored in browser persistence. Links use a fragment; opening does not consume them. Completion needs a POST from the trusted origin. Mail delivery errors use fixed text.

There was no existing email transport. The implementation uses Resend's HTTPS sending API with redirect rejection and a timeout, no SDK dependency. The email provider necessarily receives merchant account email and its verification/recovery link. It receives no payment memo, refund route, wallet credentials or customer data. This is not operator-blind identity handling.

One operator setup is required: configure a Resend sending key and sender on a domain verified with Resend. Do not paste the key into chat or Git. From the VPS:

```bash
cd ~/nostos/repo
sudo python3 scripts/web/configure-email.py
sudo systemctl start --no-block nostos-auto-deploy.service
```

The timer will run the isolated deployment when the active service finishes. Configuring mail explicitly releases a failed deployment hold for one retry. The setup prompts for the key without echoing it and writes root-only `~/nostos/email.env` outside Git. The deploy helper reads it privately and fails before building/switching if mail settings are absent. The build container receives none of these secrets. Configuration presence is not mail-delivery proof: test a real registration email after deployment. Existing merchants use **Resend verification email** on sign-in and finish the emailed link to regain merchant access. New signup collects email only, shows an inbox screen with resend, then asks for a password once after the email link is opened. Password recovery has a separate **Forgot password?** entry on sign-in. Stored payments/wallet accounts are retained.

## Pay, fulfill, refund

Fulfillment is a small merchant-reported field: pending, fulfilled or failed. Existing orders default to pending; migration does not infer historical fulfillment. Only the owning verified merchant may change a confirmed payment's state. Failure does not automatically spend. The merchant separately reviews and sends a full remaining-value or partial refund through the existing instruction flow. Fees remain additional merchant-wallet spending. The list separates order, amount, payment, fulfillment, refund and date. The same customer receipt carries refund amounts and confirmation status. The supplied private route is never displayed to prove the mechanism. No fresh address is accepted for later refund requests.

Demo with an existing or genuine new order when explicitly wanted: open its customer link, make a shielded payment with the expected memo, see confirmation, mark fulfillment failed, review a refund, confirm it, and observe the same receipt plus the customer's external wallet. The known Item21 fixture is not replaced and no additional refund is authorized by this document.

## External-wallet evidence

The real Item21 Noir payment was received and its expected memo/Orchard route validated. The operator reports the 0.018 ZEC refund confirmed on the existing receipt. On October 6, 2026, the customer explicitly confirmed that Noir received that refund after reimport and scanning. This is customer-reported independent wallet observation; the attached screenshot was unavailable to the inspecting workspace and was not independently read. The existing real payment/refund loop is therefore observed on both sides for this fixture. The exact refund record ID and transaction ID have not yet been captured in this evidence checkpoint. The automatic handoff remains unproved: this payment used manual address, amount and memo entry. Do not generalize this one manually entered wallet loop into universal wallet support.

Current primary sources checked: YWallet's repository now says it no longer supports Zcash after Ironwood and points to Zkool. Zkool's official docs list testnet connections, but the exact NOSTOS memo/receiver loop is not proven. Zingo's maintained repository and beta release setup establish continued development, not a completed NOSTOS loop. The existing Noir observation completes the manual loop; another payment or a protocol downgrade is not required.

Sources: https://github.com/hhanh00/zwallet, https://hhanh00.github.io/zkool2/, https://github.com/zingolabs/zingo-mobile, https://github.com/zingolabs/zingo-mobile/blob/dev/docs/release_quickstart.md, https://resend.com/docs/api-reference/emails/send-email.

## Verification limits

Local tests cover verified registration, expiry/reuse, durable resend throttling, unverified access denial, recovery and session revocation, email replacement, encrypted token/email storage, fixed provider errors, merchant fulfillment isolation and the existing intake/refund/privacy/restart suite. Production build verifies metadata routes. Browser verification of this candidate on mobile and desktop remains required after deployment; the cloud browser cannot reach the scratch localhost. On October 6 the operator supplied a read-only storage result: two protected product checkout routes and one protected core refund address, zero empty or invalid/unprotected values. This proves current-column encryption in that scope, not deletion, wallet-history removal, WAL or backup cleanup. The partial refund leaves 0.002 ZEC of payment value, so retaining the route remains necessary while the refund window is open. Exact current deployed SHA and live expiry/full-refund retirement are not independently verified in this checkpoint. Repository, deployed and live-verified states remain separate.

## Wallet handoff follow-up

The customer checkout uses a single-recipient `zcash:` ZIP 321 URI with an eight-decimal amount and an unpadded base64url memo. Regression coverage decodes the request and checks the exact original memo bytes, expected NOSTOS fields and integer-zat amount, including one-zat precision. This verifies request construction, not Noir parsing. Manual entry is expanded by default, has separate address/amount/memo copy actions, and copy feedback is separate from preparation errors. The wallet link says “Try opening your wallet” and tells customers to use manual entry if all three fields are not filled.

Noir's current adapter README describes a WalletConnect reference path that is mainnet-only and transparent-funded. That particular path cannot satisfy NOSTOS's shielded testnet invariant. The injected-provider path is described separately; neither description proves mobile ZIP 321 handling. No adapter, wallet connection, transparent fallback or new dependency was added. Automatic mobile handoff remains unresolved pending evidence of the installed wallet's request parsing.

Sources checked October 6, 2026: https://zips.z.cash/zip-0321 and https://github.com/NoirWallet/zcash-wallet-adapter/blob/main/README.md.
