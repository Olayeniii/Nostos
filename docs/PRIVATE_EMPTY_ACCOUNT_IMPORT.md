# Private import of a never-funded account

This operator-only helper is for the business account explicitly reported as never funded. It must not be used with an account that has received funds or whose history is uncertain. A recent birthday would miss its earlier funding notes. For such accounts, establish a birthday before their first funding separately.

The helper verifies the installed worker hash and private paths, disables core dumps, requires an interactive terminal and uses a hidden prompt. The viewing key goes to the native worker only over stdin. It is never a command argument, environment variable, application log or extra plaintext key file. Turn off terminal/session capture and screen recording before entering it. A full viewing key grants access to account transaction history. The native SDK stores its scoped viewing key and decrypted history in its private plaintext SQLite database; the database is not encrypted at rest by this helper.

The initial status query establishes mainnet tip context. Before accepting a key, a private journal saves a new isolated account namespace and a birthday 100 blocks before that tip. A retry reuses that birthday and namespace. An interrupted import can request the same key again; the SDK rejects changed account keys or birthdays. After a successful import the journal saves only the account identifier, birthday, namespace and binary hash, so further checks do not prompt for the key. The journal is separate from the SDK wallet directory.

The helper calls the read-only native sync operation, then starts another normal worker open to check persistence. The only public result is a fixed field report. `sync_ready: false` means the current tip was not fully scanned at both checks, not permission to fund or send. An error or timeout stays unresolved. Never clear the journal, change its birthday, kill an active writer or import a replacement account to retry. Reuse this procedure after the original worker has finished; its wallet lock prevents competing writes.

Run from a private terminal, without output redirection, tee, shell tracing or recording:

```sh
python3 /PATH/import-empty-account.py /PRIVATE/isolated-installation \
  --binary-sha256 REVIEWED_BINARY_SHA256 --never-funded
```

Only paste the selected business account's mainnet Unified Full Viewing Key at the hidden prompt. Never enter a seed phrase or spending key. Copy only the final fixed JSON report back to chat. Do not fund the account before import, sync and restart checks have passed.

## Operator-reported ARM64 evidence, October 23

Pinned source `1b323990cdba5809eb1978f9f572b183e2c5bbe4` built successfully on the isolated Ubuntu ARM64 host. All 25 native tests passed. Linkage resolved, package creation succeeded and the inspector reported `artifact_verified: true`, with local build origin and no GitHub run ID.

- ZIP SHA-256: `4ad715c36f3f7d1388c6200db13cc7ce206300c1cc5bc482cfaa9c49261bf085`
- Worker SHA-256: `4aeb0a96ba9c00c01a1a9d4b5a144de904eae833ff4e455b665650077b063d74`

The package was independently checked again before extraction into a fresh private installation. A temporary loopback listener test then reported authentication passed, sends blocked, native status passed and payments disabled. The listener was closed normally. This evidence was supplied by the operator, not collected through a direct VPS connection. It does not prove a live view-key import, funded control, backups or a full product cycle. The helper added afterward is Python only; it does not change the already-built native binary.
