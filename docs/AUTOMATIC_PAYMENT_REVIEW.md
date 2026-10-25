# Automatic payment review

Private incoming candidate lookup includes spent notes and pages four distinct
transactions at a time, scoped to the saved account and broker namespace. The
server verifies both supported pools with the existing exact output verifier and
durable accounting journal. Checkout and receipt polling resume after reopen.
Candidate references are never returned to public clients.

The merchant can select a whole-number verification fee limit, up to 1 ZEC,
before refund review. The saved limit cannot be changed through a repeated
review. Existing instructions keep their original limit. Unknown wallet outcomes
retain the reservation and never authorize another handoff. The external wallet
shows the actual fee and remains the only signer.

Operator evidence for 27a02b7111f8d16cf737a11bf5c1571c6ac3c1b3: 27 native fixtures
and optimized worker build passed. Worker SHA256:
bf86a3fee97fb2e6304a61e567420a0c5be044e5e8cba51ffe0711d31a32687f.
Subsequent fee and installer changes do not modify Rust source. Local validation:
408 application tests, seven detection installer tests, full app checks and
production build passed. These do not prove a real payment or refund.

Browser suite now covers receipt completion without customer txid entry, but
local Chromium launch is blocked by socket permissions. No new browser pass is
claimed. Actual ZODL signing, outgoing recovery and restored backup recovery
remain funded/operator gates.

## Private preview update

Build the exact reviewed commit with scripts/web/build-commerce-review.py. This
stages a fresh build without switching services, reuses the existing Rust cache,
and supplies NOSTOS_BACKUP_FIXTURE. Keep all existing build directories.

After build-result.json confirms success, run install-detection-review.py with
--revision set to that exact commit and --worker-sha256 set to the verified
worker hash from the build result. It requires the currently installed c370ee2
private commerce container and config, preserves runtime/data, data key, RPC
cookies and wallet state, starts the updated broker from reviewed source, and
rolls back to the old broker and web container on failed health checks.
Unauthenticated observer health uses POST / = 401. No production or testnet
service is switched. No send is requested. Inspect the private checkout and
refund review on phone and desktop before funding.
