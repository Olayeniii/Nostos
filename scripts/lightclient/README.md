# View-only SDK observer

This is the selected mainnet observer source. It has no signing or broadcast interface. The web application connects through an authenticated loopback broker, with merchant-scoped private worker storage.

## Modules

| File                                                                 | Role                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `observer.rs`, `connection.rs`                                       | Account import, scan readiness and allowed native operations                          |
| `transactions.rs`                                                    | Full transaction enhancement, chain context and exact incoming/outgoing output checks |
| `storage.rs`                                                         | Private paths, SQLite files, writer lock and candidate discovery                      |
| `worker.rs`                                                          | Bounded private stdin/stdout protocol                                                 |
| `service.mjs`, `run-service.mjs`                                     | Authenticated, scoped loopback broker and configuration validation                    |
| `backup.py`                                                          | `age` encrypted SQLite snapshot and offline restore                                   |
| `transaction_tests.rs`, `observer_fixture.rs`, `recovery_fixture.rs` | Native fixture coverage, persistence and recovery tests                               |

The pinned upstream SDK checkout is Zallet `987382f67e622915228686e9f956c6a9c9a7514c`. The preparation helper selects the locked provider/features and validates dependency metadata. Native source changes require native tests and a fresh build before artifact installation.

## Verification

The worker checks exact account, receiver, integer amount, padded memo, pool, direction and confirmations. Outgoing product proof also requires an owned spend and an actual fee within the saved ceiling. Transparent and unsupported cross-pool paths, ambiguous outputs, stale chain anchors and missing outgoing recovery fail closed.

Candidate enumeration includes received notes that were later spent and outgoing spends recorded for the observed account. The application, not the browser, derives expected fields from saved instructions. See [observer records](../../docs/OBSERVER_RECORDS.md).

## Storage and transport

Native databases contain scoped viewing keys and decrypted history in plaintext behind private file permissions. A writer lock and no-follow/path checks guard access, including WAL/SHM and journal files. Product-field encryption is separate. [Backup archives](../../docs/SDK_OBSERVER_BACKUPS.md) use `age`; a restored database is plaintext again.

The gRPC transport permits public chain reads only. Hosted services can see client network metadata, requested ranges and transaction references. Confirmed context is checked against the SDK's scanned chain view, not independent full-node consensus validation.

The HTTP broker allows status, viewing-key import, receiver decoding, candidate lists and output proof. It rejects signing, sends and the private control harness. Busy sync cannot report readiness. Worker errors omit raw keys, memos and provider responses.

## Builds and evidence

See [ARM64 builds](../../docs/LOCAL_ARM64_BUILD.md) for isolated packaging and [build status](../../docs/BUILD_STATUS.md) for the mainnet release status. Packages include only a fixed source/binary/provenance list, never wallet state or credentials.

Offline encrypted transaction fixtures contain invalid proof/signature placeholders and cannot be broadcast. They exercise decoding, matching, persistence and restore; they are not funded evidence. The [private control harness](CONTROL_TEST.md) is separate from product settlement and does not participate in checkout or refund accounting.
