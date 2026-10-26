# Validation while hosted Actions allowance is exhausted

Automatic workflow events are temporarily paused in this change. All seven
workflows accept only `workflow_dispatch`; each also cancels an older run of the
same workflow and ref. No runner type, validation step, dependency pin, required
check or repository permission is removed.

This takes repository-wide effect only after the workflow change is reviewed and
merged. Until then, default-branch workflows remain as configured on main. Do not
enable paid usage, change repository visibility or install a runner on a live
wallet host as part of this change.

## Work without hosted minutes

Use an isolated source checkout with Node 24 and pnpm 11. Keep wallet files,
viewing keys, production credentials and product databases outside the checkout.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @nostos/web build
python3 -m unittest discover -s scripts/web -p 'test_*.py'
python3 -m unittest discover -s scripts/observer -p 'test_*.py'
python3 -m unittest discover -s scripts/lightclient -p 'test_*.py'
node --test scripts/lightclient/service.test.mjs
```

Record the source commit, environment, commands, outcomes and any skipped checks
in the PR. A blocked Actions job is not a failed application test. Local results
do not create a successful GitHub check and do not bypass required checks.

Rust changes still require the pinned compiler, SDK dependencies and native
tests. An earlier binary validates only its tested source. Reuse a verified
artifact for unchanged native code; retain its source commit and independent CI
hashes. Do not describe TypeScript or mocked tests as a fresh native build or a
funded proof. An isolated build host can run the workflow's pinned commands
directly without registering a GitHub runner.

## Restore after the allowance resets

The expected reset is November 1, 2026. Restoration is deliberate, not automatic:

1. Confirm available minutes and storage in GitHub billing.
2. Restore application CI for pull requests and pushes to main, plus manual
   dispatch. Do not restore unrestricted feature-branch pushes alongside PR
   runs, which caused duplicate application builds.
3. Keep native packages, cross-platform wallet gates, provider probes and visual
   review manual. Run them on a reviewed checkpoint when their inputs change.
4. Keep concurrency cancellation. Add a bounded monthly usage policy before
   enabling further automatic native builds.

Do not merge a transaction change on the strength of this cost-control patch.
The merchant-wallet release hold, isolated installation, private import and
funded approval requirements remain in force.
