# Validation

Requires Node.js 24 and pnpm 11. Use a source checkout without wallet exports, product databases or live credentials.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @nostos/web build
python3 -m unittest discover -s scripts/web -p 'test_*.py'
python3 -m unittest discover -s scripts/observer -p 'test_*.py'
python3 -m unittest discover -s scripts/lightclient -p 'test_*.py'
```

`pnpm test` runs Vitest application tests and the separate Node test suites with their correct runners. Python checks use temporary configuration and databases; environment-specific prerequisites such as `age` are documented by their tests. Browser checks use explicit fixture transport and require Playwright/Chromium separately.

## Hosted workflows

The workflows are manual (`workflow_dispatch`) while hosted Actions allowance is exhausted. Concurrency cancellation prevents overlapping runs for the same workflow and ref. Local results do not create a successful GitHub check or bypass branch requirements.

Restore automatic application CI deliberately after confirming available allowance. Keep expensive native builds, provider probes and visual review manual unless their inputs change. Do not enable paid usage or install a runner on a live wallet host merely to obtain checks.

## Native builds

Rust changes require the pinned compiler, SDK graph, native fixtures and a new verified artifact. A previous binary validates only its matching source. [ARM64 builds](LOCAL_ARM64_BUILD.md) document the isolated host procedure. Preserve source revision, build log and SHA-256 independently from an artifact's own checksum file.

Tests, mock responses, package checks, public-chain probes, operator-reported runtime output and funded transactions are different evidence. Record the source and scope with each result. See [build status](BUILD_STATUS.md) for the latest recorded application checkpoint.
