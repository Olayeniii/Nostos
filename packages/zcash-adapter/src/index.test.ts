import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZalletRpcClient } from "./index.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function endpoint(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

const privateRoute = "utest1" + "b".repeat(80);
const privateOrder = "synthetic_private_order";
const privateMemo = JSON.stringify({
  p: "nostos",
  v: 1,
  o: privateOrder,
  r: privateRoute,
});

describe("wallet RPC privacy boundary", () => {
  it.each([
    "http://127.0.0.1:1234@outside.invalid/",
    "http://localhost:1234@outside.invalid/",
    "http://127.0.0.1.outside.invalid:1234/",
    "http://localhost.outside.invalid:1234/",
    "http://user:password@127.0.0.1:1234/",
    "http://user@localhost:1234/",
    "http://[::2]:1234/",
    "https://127.0.0.1:1234/",
    "http://127.0.0.1:1234/#private-fragment",
    "invalid-url",
  ])("rejects unsafe endpoint %s without exposing it", (url) => {
    expect(() => new ZalletRpcClient({ url })).toThrow(
      "Zallet RPC must use a loopback HTTP address.",
    );
  });

  it.each([
    "http://127.0.0.1:1234/",
    "http://localhost:1234/",
    "http://[::1]:1234/",
  ])("accepts parsed loopback endpoint %s", (url) => {
    expect(() => new ZalletRpcClient({ url })).not.toThrow();
  });

  it.each([
    privateMemo,
    Buffer.from(privateMemo).toString("hex"),
    Buffer.from(privateMemo).toString("base64url"),
  ])("omits plaintext and encoded wallet error content", async (message) => {
    const url = await endpoint(
      createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: { code: -8, message } }));
      }),
    );
    const client = new ZalletRpcClient({
      url,
      user: "user",
      password: "password",
    });
    await expect(client.listUnspent()).rejects.toMatchObject({
      message: "Zallet RPC z_listunspent failed (-8).",
    });
  });

  it("does not trust nonnumeric RPC codes or arbitrary method names", async () => {
    const url = await endpoint(
      createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            error: { code: privateMemo, message: privateMemo },
          }),
        );
      }),
    );
    const client = new ZalletRpcClient({
      url,
      user: "user",
      password: "password",
    });
    await expect(client.call(privateOrder)).rejects.toMatchObject({
      message: "Zallet RPC request failed (unknown).",
    });
  });

  it("replaces transport errors and discards their causes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error(privateMemo, {
          cause: { credentials: "synthetic-credential" },
        }),
      ),
    );
    const client = new ZalletRpcClient({
      url: "http://127.0.0.1:1234",
      user: "user",
      password: "password",
    });
    const error = await client.listUnspent().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Zallet RPC z_listunspent transport failed.",
    );
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).stack).not.toContain(privateMemo);
  });

  it("does not expose cookie paths in credential read failures", async () => {
    const client = new ZalletRpcClient({
      url: "http://127.0.0.1:1234",
      cookieFile: "/nonexistent/nostos-synthetic-private-cookie",
    });
    await expect(client.listUnspent()).rejects.toThrow(
      "Zallet RPC z_listunspent credentials are unavailable.",
    );
  });

  it("does not expose response text in JSON parser failures", async () => {
    const url = await endpoint(
      createServer((_request, response) =>
        response.end(privateMemo + "invalid"),
      ),
    );
    const client = new ZalletRpcClient({
      url,
      user: "user",
      password: "password",
    });
    await expect(client.listUnspent()).rejects.toThrow(
      "Zallet RPC z_listunspent returned invalid JSON.",
    );
  });

  it("does not follow redirects or send wallet data to the redirect target", async () => {
    let targetRequests = 0;
    const target = await endpoint(
      createServer((_request, response) => {
        targetRequests++;
        response.end(JSON.stringify({ result: [] }));
      }),
    );
    const url = await endpoint(
      createServer((_request, response) => {
        response.writeHead(307, { Location: target });
        response.end();
      }),
    );
    const client = new ZalletRpcClient({
      url,
      user: "user",
      password: "password",
    });
    await expect(
      client.sendFromAccount("synthetic-account", "orchard", [
        {
          address: privateRoute,
          amount: 0.01,
          memo: Buffer.from(privateMemo).toString("hex"),
        },
      ]),
    ).rejects.toThrow("Zallet RPC z_sendfromaccount transport failed.");
    expect(targetRequests).toBe(0);
  });

  it("keeps the validated endpoint when the caller changes its config", async () => {
    const url = await endpoint(
      createServer((_request, response) => {
        response.end(JSON.stringify({ result: [] }));
      }),
    );
    const config = { url, user: "user", password: "password" };
    const client = new ZalletRpcClient(config);
    config.url = "http://outside.invalid:1234/";
    await expect(client.listUnspent()).resolves.toEqual([]);
  });
});

async function requestBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("ZalletRpcClient", () => {
  it("sends an account-scoped fully shielded payment", async () => {
    let observed: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      observed = await requestBody(request);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a".repeat(64) }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind.");

    const client = new ZalletRpcClient({
      url: `http://127.0.0.1:${address.port}`,
      user: "user",
      password: "password",
    });
    const txid = await client.sendFromAccount("account-uuid", "orchard", [
      { address: `utest1${"b".repeat(80)}`, amount: 0.01, memo: "7b7d" },
    ]);

    expect(txid).toBe("a".repeat(64));
    expect(observed).toMatchObject({
      method: "z_sendfromaccount",
      params: [
        "account-uuid",
        "orchard",
        [{ address: `utest1${"b".repeat(80)}`, amount: 0.01, memo: "7b7d" }],
        1,
        "FullPrivacy",
      ],
    });
  });

  it("refuses a non-loopback wallet endpoint", () => {
    expect(
      () =>
        new ZalletRpcClient({
          url: "http://192.0.2.1:28232",
          user: "user",
          password: "password",
        }),
    ).toThrow("loopback");
  });

  it("omits the address filter when listing every wallet note", async () => {
    let observed: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      observed = await requestBody(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind.");
    }

    const client = new ZalletRpcClient({
      url: `http://127.0.0.1:${address.port}`,
      user: "user",
      password: "password",
    });
    await client.listUnspent();

    expect(observed).toMatchObject({
      method: "z_listunspent",
      params: [1, 9_999_999, false],
    });
  });

  it("reads wallet-visible outputs from a historical transaction", async () => {
    let observed: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      observed = await requestBody(request);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            confirmations: 12,
            outputs: [{ pool: "ironwood", valueZat: 2_000_000 }],
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind.");
    }

    const client = new ZalletRpcClient({
      url: `http://127.0.0.1:${address.port}`,
      user: "user",
      password: "password",
    });
    const txid = "f".repeat(64);
    await expect(client.viewTransaction(txid)).resolves.toMatchObject({
      txid,
      confirmations: 12,
      outputs: [{ pool: "ironwood", valueZat: 2_000_000 }],
    });
    expect(observed).toMatchObject({
      method: "z_viewtransaction",
      params: [txid],
    });
  });
});
