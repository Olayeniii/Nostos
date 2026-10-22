# VPS Node security update, 22 October 2026

## Completed host checkpoint

Evidence below was supplied by the operator from the VPS terminal. Work has no
direct VPS connection and did not independently execute these commands.

- Host architecture: ARM64, NodeSource Node 22 repository.
- Installed host package before the change: `22.23.2-1nodesource1`.
- APT simulation: one upgrade, no new packages, no removals; 47 other packages
  left unchanged.
- The operator explicitly approved the host-only update, with automatic service
  restarts suppressed. The command supplied was:

  ```sh
  sudo env NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l apt-get install --only-upgrade --no-remove nodejs=22.23.4-1nodesource1
  ```

- Subsequent host `node --version`: `v22.23.4`.
- Subsequent `nostos-web` version: `v24.21.0`, still awaiting its own update.
- Docker status after the host update: web up 12 hours, Zebra up 15 hours,
  `nostos-build-1792540249` up 36 hours, unrelated PostgreSQL up seven weeks.
- Both `nostos-wallet@customer.service` and
  `nostos-wallet@merchant.service` report `ActiveState=active` and
  `ExecMainStartTimestamp=Wed 2026-10-21 20:12:44 UTC`.

The supplied uptimes and wallet start timestamps support continuity through the
host update. They do not prove wallet RPC health, synchronization, payment
operation or mainnet readiness. No wallet RPC or private data inspection was
requested for this host checkpoint. The long-running build container has not
been stopped or removed; its purpose and resource use remain unverified.

## Existing web runtime

Operator-supplied image metadata:

- Tag: `node:24-bookworm-slim`.
- Digest:
  `node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
- Platform: `linux/arm64`.
- Running Node: `v24.21.0`.

The host update does not replace the web container runtime. The proposed web
target is `node:24.22.1-bookworm-slim`, resolved and recorded by digest before
use. No new image digest is asserted before inspection.

## Source review and remaining deployment blockers

Reviewed branch: `fix/dependency-security-oct22`, remote source checkpoint
`ce9fe4610090f635b5cd65d1d76778ccea434c66`. The tested application/security code
checkpoint remains `de1eb1f4ede9cf4b78e25e55f1a403b64ea978ba`.

At that source checkpoint, `scripts/web/deploy.py`:

1. Uses the existing container's `Config.Image` for the builder, preview and
   final container. It has no reviewed explicit runtime-image override. An old
   image fails the newly added Node guard; updating the host will not help.
2. Reuses product storage and private configuration for its preview. The health
   probe opens product databases. Disabling retention does not make this an
   isolated storage or wallet-access test.
3. Builds the checked-out Git HEAD, which can combine application changes with
   a runtime change. The currently deployed release revision and dependency
   versions have not been established by these operator reports.

Do not run that deployer to perform the proposed runtime update yet. A future
runtime-only switch must keep the same deployed application release, unless a
specific source/dependency release is separately reviewed and approved. A Node
image update alone does not deploy the prepared Next.js/React dependency fixes.

## Staged plan for separate approval

### A. Image download and isolated probe

Approval requested for this bounded stage only when the operator is ready:

- Download `node:24.22.1-bookworm-slim` for `linux/arm64`, record its registry
  digest and local image ID, and preserve the old image.
- Run only the new image's `node --version`, without application code, injected
  environment, host mounts, wallet access, published ports or a network.
- Proposed probe limits: 128 MiB memory, 128 MiB total memory plus swap,
  0.25 CPU, 32 processes, read-only root filesystem, all capabilities dropped,
  no new privileges, no restart policy, and a 30-second execution limit with
  cleanup restricted to the probe itself.
- First confirm sufficient free disk and memory and identify whether the
  existing build is consuming resources. Inspection prints only names, states,
  resource totals and image metadata. Do not print container environments,
  logs or full Docker configuration. Do not stop the existing build.

Stage A changes only the image cache and creates/removes the bounded temporary
probe. It does not restart web, Zebra, wallets, Docker or the host; pull limits
and image disk requirements must be considered before the operator starts it.
If the target image is unavailable, its architecture differs, its version is
unexpected, or headroom is insufficient, stop this stage.

### B. Prepare a web candidate

After successful image evidence, prepare and review a runtime-only procedure:

- Read the live application release revision and mount configuration privately,
  emitting only an allowlisted report. Verify actual service and volume
  isolation, port availability and the deploy lock before any candidate starts.
- Use the verified image ID/digest in every candidate configuration, keeping the
  exact existing application release. Native dependencies require an ARM64
  compatibility check; a version-only image probe is insufficient.
- Use separate product database copies made with a SQLite-consistent backup,
  separate runtime storage, no wallet mounts and no live signing credentials.
  Do not copy wallet databases, seeds or chain volumes. Any required product
  decryption credential stays local and is never printed; access is a separate
  approved part of staging.
- Disable background retention, payment/refund execution and real email sends
  in the candidate, and enforce network restrictions so configuration alone
  cannot reach the recovered wallet services.
- Bind any approved preview only to loopback on a verified unused port. Test
  sign-up page response, anonymous session rejection, database loading and
  native dependency loading without sending mail, observing live wallet keys
  or invoking payment/refund operations.

This preview procedure has not been implemented or run. Its privacy controls,
resource budget, backup handling and any temporary staging service need review
before execution. Existing CI validates source changes, not this live candidate.

### C. Web-only production switch

Requires explicit approval of the exact image digest, application revision,
staging evidence, maintenance window and rollback procedure. Coordinate with
the five-minute auto-deployer so it cannot race or undo the runtime switch;
changes to its timer require approval too. Do not merge to main to trigger this.

Retain the original container and image for rollback. Stop and replace only
`nostos-web`, verify version and HTTP/database health, and restore the original
container immediately if health fails. Never remove or recreate product data
during rollback. Reject a configuration that changes wallet/chain mounts or
their service definitions. Zebra and both wallet services, ports, files and
volumes remain outside the change.

## Current approval boundary

Host update: approved and operator-reported complete. Stages A, B and C:
not yet approved or executed. Source branch changes, mainnet enablement, live
viewing-key import, signing, funded transactions and merging to main retain
their existing separate gates. The offline Android account-binding result is
still pending; this runtime work does not establish wallet compatibility.

References:

- [Node security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [needrestart environment controls](https://manpages.debian.org/bookworm/needrestart/needrestart.1.en.html)
- [Dependency source and CI evidence](DEPENDENCY_SECURITY_2026_10_22.md)
