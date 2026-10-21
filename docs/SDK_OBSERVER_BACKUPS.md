# SDK observer backup and restore

This procedure is for the separate SDK mainnet observer preview. It has not been
run on the VPS. It does not back up Zallet signing wallets, the product database,
its encryption key, app credentials, or the merchant's signing-wallet recovery
material. Those need their own protected backups. Mainnet payments remain held.

## What is stored

`backup.py` takes an SQLite backup snapshot, including committed WAL contents,
while holding the same Linux writer lock as the native worker. An active worker
causes immediate refusal. The tool never stops or restarts a service. Uncommitted
writes are excluded by SQLite. No WAL checkpoint, database migration or send is
requested.

The snapshot is serialized in memory, wrapped with the merchant UUID, mainnet
marker, format version and SHA-256, then piped into `age`. Only ciphertext is
written as a backup. The serialized copy uses SQLite's documented byte-18/19
adjustment for in-memory deserialization of WAL snapshots. The source database
header is never edited. Reference: <https://sqlite.org/c3ref/deserialize.html>.

Restore verifies successful age decryption, the expected merchant and format,
the database hash, SQLite integrity and basic observer schema. It creates a new
private directory with the same merchant UUID under a separate parent, then uses
SQLite backup to write the restored database. An existing destination is refused,
even if it looks empty. Corrupt ciphertext or a wrong merchant fails before the
restored directory is created. Backups and database files are mode 0600; private
working directories are mode 0700, with owner and ancestor checks.

This is an offline manual tool. A merchant observer resumes only after the
operator separately verifies the restored SDK account, birthday, scan checkpoint
and current chain sync. Restoring history does not confirm a payment or refund.
The tool has a 256 MiB snapshot limit and a two-minute age process limit. Larger
wallets need a reviewed streaming procedure, not a higher untested limit.

## Operator inputs and recovery key

Use a dedicated age recipient whose corresponding identity is stored separately
from the server and archive. Keep a second secure copy under the operator's
control. Losing that identity makes the archive unrecoverable. This tool accepts
a private raw age identity file for noninteractive restore; it does not prompt for
an identity passphrase. Never paste that file or its contents into chat or logs.
The backup recipient is public and does not authorize wallet spending.

Prerequisites are Python with SQLite backup/serialize/deserialize support and the
`age` executable. Confirm worker shutdown under a separately approved deployment
procedure before backup. A running writer is refused rather than stopped.

For a single merchant, use the script's `backup` subcommand with `--root`,
`--destination`, `--recipient` and `--merchant`. The root directory name must equal
the merchant UUID. Store the destination outside the wallet root in a private
backup directory. Existing files cannot be overwritten.

Use `restore` with `--archive`, `--destination`, `--identity` and `--merchant`.
The destination is a nonexistent directory named with that same UUID beneath a
new private restore parent. It must not be a live wallet path. Do not replace the
current wallet as part of the restore check. Preserve the original and rollback
until current-chain verification is complete.

The original encrypted viewing-key claim in the product database is separate.
This backup contains the scoped SDK viewing key, transaction history and any
stored decrypted memos, encrypted by age. It does not erase other retained copies.
The restored database is plaintext behind filesystem permissions, like the SDK
source. Filesystem protections do not establish live log or backup hygiene.

## Evidence and limits

CI checks SQLite snapshot consistency with a committed WAL entry and a separate
uncommitted write; writer exclusion; unsafe paths; real age encrypt/decrypt;
refusal to overwrite; wrong-merchant rejection; and damaged-ciphertext rejection.
The SDK test stores decrypted incoming Orchard and Ironwood memos and raw
transactions, reopens the wallet, encrypts and restores it, then reopens the restored
wallet through the native SDK and checks the same memo and transaction again.
The native writer-lock exclusion is checked across Rust and Python processes.

Those encrypted-note transactions have invalid proof/signature placeholders and
are deliberately unmined. No real merchant key, funded settlement, live VPS
backup, independent offsite archive or merchant recovery exercise is established
by these tests. No automated restore or backend switch is included.

## Verified run, 21 October 2026

SDK [run 39659003901](https://github.com/Olayeniii/Nostos/actions/runs/39659003901)
passed at 19:12 UTC for `fed823db31db83da3e2686ec30b5f1f1e7127c91`.
The three Python backup tests ran with real age tools, including WAL consistency,
wrong-merchant and corrupt-archive rejection. Fifteen SDK observer tests passed,
including the decrypted memo/full-transaction reopen and age restore in both
pools, plus cross-process native writer-lock exclusion. The viewing-key test and
two HTTP/broker tests passed. Existing public-chain sync, rewind, abrupt-exit and
service connection fixtures also passed. Application CI
[39659003515](https://github.com/Olayeniii/Nostos/actions/runs/39659003515) passed.

The first two attempts failed because Cargo runs package tests from the package
working directory and the backup helper was supplied as a relative path. CI now
uses an absolute path and checks that it exists. No wallet or refund policy was
changed to make the test pass.
