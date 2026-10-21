import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createObserverService } from "./service.mjs";

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
