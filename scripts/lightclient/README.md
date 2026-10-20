# Isolated light-client observer work

This is a CI-only foundation, not a deployed observer service. It has no merchant
key input, listener, signing operation, send operation or production wallet path.
The existing app and VPS continue to use their current configuration.

`probe.rs` checks public mainnet metadata and actual SDK decoding against two
reference-wallet lightwalletd endpoints. `observer.rs` adds a bounded disposable
compact-block cache and SDK SQLite view-only import. `observer_fixture.rs` uses
public deterministic test material, a temporary database and recent mainnet
blocks to test scanning and reopening the stored checkpoint. The temporary
directory is deleted when the fixture exits normally. No wallet file is uploaded
as a workflow artifact or included in the Cargo cache.

The fixture checks same-key import without duplicate accounts and rejects a
different key or birthday. Temporary server failures have at most three attempts;
wallet, tree, scan, cache and non-transient server errors stop with fixed error
categories. The fixture has a total time limit. A failed run is not a sync pass.

The cache tests cover missing blocks, invalid block metadata, range deletion and
rewind behavior. SQLite holds the scan state; the disposable cache can be rebuilt
after reopening. Reopening after a completed scan is not a simulated mid-write
crash or a full reorg test.

## Gates before real merchant view access

1. Add full-transaction retrieval and decryption. The pinned SDK `sync::run`
   explicitly does not enhance detected transactions. Compact scanning alone
   does not prove memo intake or an exact outgoing refund receiver.
2. Add fixtures for exact incoming output, amount, expected memo and pool, plus
   outgoing receiver, amount, pool and confirmation matching. Never accept an
   amount-only match or transparent fallback.
3. Add protected storage paths, exclusive writer locking, restrictive database,
   WAL and SHM handling, encrypted backup policy and crash/reorg tests. The
   current `open_fixture` helper is intentionally limited to temporary CI data.
4. Review the complete sync privacy model. The pinned dependency graph enables
   transparent-input support. The fixture removes the transparent component from
   its public test UFVK; imports reject keys containing transparent view access.
   Its transport interceptor allows only five shielded-chain read methods and
   blocks all others before transport. These restrictions must remain in the
   production adapter. Real full-key intake still needs explicit scope handling
   and consent; the fixture is not that interface. Downloading compact blocks over
   TLS alone does not establish privacy of the whole sync process.
5. Add the authenticated application adapter and compare it with existing account
   and refund policies. Keep mainnet payments held until real sync and independently
   verified payment/refund evidence exist.

`prepare.py` enables the pinned SDK sync feature and selects the pinned Rustls
provider only in the CI checkout. It asserts unchanged package versions, sources
and checksums. This does not modify or install the VPS wallet binary.
