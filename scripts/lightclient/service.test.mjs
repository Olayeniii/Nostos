import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObserverBroker, createObserverService } from "./service.mjs";

test("address validation waits for background sync after import", async () => {
  const root = mkdtempSync(join(tmpdir(), "nostos-broker-race-"));
  chmodSync(root, 0o700);
  const calls = [];
  let finishSync, syncStarted;
  const syncing = new Promise((resolve) => {
    finishSync = resolve;
  });
  const started = new Promise((resolve) => {
    syncStarted = resolve;
  });
  const worker = {
    busy: false,
    dead: false,
    async request(method) {
      assert.equal(this.busy, false, "pipe operations must never overlap");
      calls.push(method);
      this.busy = true;
      try {
        if (method === "nostos_sync") {
          syncStarted();
          await syncing;
        }
        if (method === "z_listunifiedreceivers")
          return { orchard: "fixture-address" };
        return { account_connected: true, payments_enabled: false };
      } finally {
        this.busy = false;
      }
    },
    async close() {},
  };
  const broker = new ObserverBroker({ root, factory: () => worker });
  const merchant = "4b723cba-3e4d-4536-9c2e-e8129e2fb731";
  // Keep the event loop alive while the broker's unref timer starts sync.
  const timeout = setTimeout(() => syncStarted(), 1000);
  try {
    await broker.request(merchant, "z_importviewingkey", []);
    await started;
    assert.equal(worker.busy, true);
    const status = broker.request(merchant, "getwalletstatus", []);
    const first = broker.request(merchant, "z_listunifiedreceivers", []);
    const second = broker.request(merchant, "z_listunifiedreceivers", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["z_importviewingkey", "nostos_sync"]);
    finishSync();
    assert.deepEqual(await status, {
      account_connected: true,
      payments_enabled: false,
    });
    assert.deepEqual(await first, { orchard: "fixture-address" });
    assert.deepEqual(await second, { orchard: "fixture-address" });
    assert.deepEqual(calls, [
      "z_importviewingkey",
      "nostos_sync",
      "getwalletstatus",
      "z_listunifiedreceivers",
      "z_listunifiedreceivers",
    ]);
  } finally {
    clearTimeout(timeout);
    finishSync();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("HTTP authentication, scope and method restrictions precede worker access", async () => {
  const calls = [];
  const authorization = `Basic ${Buffer.from("public-test-cookie:fixture-only").toString("base64")}`;
  const broker = {
    request: async (...args) => {
      calls.push(args);
      return { payments_enabled: false };
    },
  };
  const server = createObserverService({ authorization, broker });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/`,
    merchant = "4b723cba-3e4d-4536-9c2e-e8129e2fb731";
  const body = (method, params) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const send = async (payload, extra = {}) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization, ...extra },
      body: payload,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal(
      (
        await send(body("getwalletstatus", [merchant]), {
          authorization: "Basic invalid",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await send(body("getwalletstatus", [merchant]), {
          origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await send(body("z_sendfromaccount", [merchant]))).body.error.code,
      -32601,
    );
    assert.equal(
      (await send(body("nostos_sync", [merchant]))).body.error.code,
      -32601,
    );
    assert.equal(
      (
        await send(
          body("nostos_control", [
            merchant,
            null,
            "private",
            "private",
            merchant,
          ]),
        )
      ).body.error.code,
      -32601,
    );
    assert.ok(
      (await send(body("getwalletstatus", ["../different-wallet"]))).body.error,
    );
    assert.ok(
      (await send(body("getwalletstatus", [merchant, "extra"]))).body.error,
    );
    assert.equal(calls.length, 0);
    const ok = await send(body("getwalletstatus", [merchant]));
    assert.equal(ok.body.result.payments_enabled, false);
    assert.deepEqual(calls, [[merchant, "getwalletstatus", []]]);
    const proofParams = [
      merchant,
      merchant,
      "a".repeat(64),
      "u1" + "b".repeat(60),
      1000,
      "00",
      "ironwood",
      "incoming",
      merchant,
      0,
    ];
    for (const [field, value] of [
      [1, "../other-account"],
      [2, "invalid"],
      [4, 1.5],
      [5, "ff".repeat(513)],
      [6, "transparent"],
      [7, "change"],
      [8, "../binding"],
      [9, -1],
    ]) {
      const invalid = [...proofParams];
      invalid[field] = value;
      assert.ok((await send(body("nostos_verify_output", invalid))).body.error);
    }
    assert.equal(calls.length, 1);
    assert.equal(
      (await send(body("nostos_verify_output", proofParams))).body.result
        .payments_enabled,
      false,
    );
    assert.deepEqual(calls[1], [
      merchant,
      "nostos_verify_output",
      proofParams.slice(1),
    ]);
    const secret = "uview1" + "a".repeat(100);
    broker.request = async () => {
      throw new Error(secret);
    };
    const failed = await send(
      body("z_importviewingkey", [merchant, secret, "whenkeyisnew", 10]),
    );
    assert.equal(failed.body.error.message, "Observer request is unresolved.");
    assert.ok(!JSON.stringify(failed).includes(secret));
    assert.equal((await send("x".repeat(16385))).status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("persisted account status resumes sync without another viewing-key import", async () => {
  const root = mkdtempSync(join(tmpdir(), "nostos-public-broker-"));
  chmodSync(root, 0o700);
  const calls = [];
  let finishSync;
  const syncing = new Promise((resolve) => {
    finishSync = resolve;
  });
  let syncStarted;
  const started = new Promise((resolve) => {
    syncStarted = resolve;
  });
  const worker = {
    busy: false,
    dead: false,
    async request(method) {
      calls.push(method);
      if (method === "nostos_sync") {
        this.busy = true;
        syncStarted();
        await syncing;
        this.busy = false;
      }
      return {
        account_connected: true,
        payments_enabled: false,
        locked: false,
        node_tip: { height: 100 },
      };
    },
    async close() {},
  };
  const broker = new ObserverBroker({ root, factory: () => worker });
  const merchant = "4b723cba-3e4d-4536-9c2e-e8129e2fb731";
  const timeout = setTimeout(() => syncStarted(), 1000);
  try {
    await broker.request(merchant, "getwalletstatus", []);
    await started;
    assert.deepEqual(calls, ["getwalletstatus", "nostos_sync"]);
    const pending = broker.request(merchant, "getwalletstatus", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 2);
    finishSync();
    const fresh = await pending;
    assert.equal(fresh.locked, false);
    assert.equal(fresh.payments_enabled, false);
    assert.equal(calls.length, 3);
  } finally {
    clearTimeout(timeout);
    finishSync();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
