import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { assertNodeRuntime } from "./node-runtime.mjs";

test("old security patches and untested release lines cannot open a service", () => {
  for (const version of [
    "24.19.0",
    "24.22.0",
    "22.23.4",
    "26.12.1",
    "24.22.1-custom",
    "invalid",
  ])
    assert.throws(() => assertNodeRuntime(version));
  for (const version of ["24.22.1", "24.23.0"])
    assert.doesNotThrow(() => assertNodeRuntime(version));
});

test("old runtime is refused before a private configuration path is read", () => {
  const entry = new URL("./run-service.mjs", import.meta.url).href;
  const script = `Object.defineProperty(process.versions, "node", {value: "24.19.0"});
    const {startConfiguredService} = await import(${JSON.stringify(entry)});
    startConfiguredService("/nonexistent-private-configuration");`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node 24\.22\.1/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});
