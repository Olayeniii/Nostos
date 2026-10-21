// CI-only public key enters through stdin, never argv, files or output.
import { once } from "node:events";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createObserverService, ObserverBroker } from "./service.mjs";

const deadline = setTimeout(() => process.exit(1), 120000);
deadline.unref();
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 8192) process.exit(1);
  chunks.push(chunk);
}
const root = mkdtempSync(join(tmpdir(), "nostos-pipe-e2e-"));
chmodSync(root, 0o700);
const broker = new ObserverBroker({
  root,
  binary: resolve(process.argv[2]),
  autoSync: false,
});
const authorization = `Basic ${Buffer.from(`__test__:${randomBytes(32).toString("hex")}`).toString("base64")}`;
const server = createObserverService({ authorization, broker });
let passed = false;
let stage = "input";
try {
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    !input.public_fixture_only ||
    typeof input.key !== "string" ||
    !Number.isSafeInteger(input.birthday)
  )
    throw Error();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`;
  const first = "4b723cba-3e4d-4536-9c2e-e8129e2fb731",
    other = "e9e17ca7-8694-49d0-acec-d7315df96975";
  let sequence = 0;
  const call = async (method, params, auth = authorization) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params }),
      signal: AbortSignal.timeout(60000),
    });
    return { status: response.status, body: await response.json() };
  };
  stage = "authentication";
  if ((await call("getwalletstatus", [first], "Basic invalid")).status !== 401)
    throw Error();
  if ((await call("z_sendfromaccount", [first])).body.error?.code !== -32601)
    throw Error();
  stage = "initial_status";
  const before = (await call("getwalletstatus", [first])).body.result;
  if (
    !before?.nostos_sdk_preview_v1 ||
    before.payments_enabled !== false ||
    !before.node_tip?.blockhash
  )
    throw Error();
  const params = [first, input.key, "whenkeyisnew", input.birthday];
  stage = "import";
  const imported = (await call("z_importviewingkey", params)).body.result;
  const again = (await call("z_importviewingkey", params)).body.result;
  if (
    !imported?.nostos_view_only_v1 ||
    imported.account_uuid !== again?.account_uuid ||
    imported.address !== again.address
  )
    throw Error();
  stage = "receivers";
  const receivers = (
    await call("z_listunifiedreceivers", [first, imported.address])
  ).body.result;
  if (
    Object.keys(receivers ?? {}).join(",") !== "orchard" ||
    receivers.orchard !== imported.address
  )
    throw Error();
  if (
    !(
      await call("z_importviewingkey", [
        first,
        input.key,
        "whenkeyisnew",
        input.birthday + 1,
      ])
    ).body.error
  )
    throw Error();
  stage = "namespace";
  const separate = (await call("getwalletstatus", [other])).body.result;
  if (
    !separate ||
    separate.wallet_tip !== null ||
    separate.locked !== true ||
    separate.payments_enabled !== false ||
    "address" in separate
  )
    throw Error();
  passed = true;
} catch {
  // Do not emit responses, parameters, private routes or worker error details.
} finally {
  await new Promise((resolve) => server.close(resolve));
  await broker.close();
  rmSync(root, { recursive: true, force: true });
}
process.stdout.write(
  JSON.stringify({
    service_pipe_e2e_passed: passed,
    failed_stage: passed ? null : stage,
    sends_requested: 0,
  }) + "\n",
);
if (!passed) process.exitCode = 1;
