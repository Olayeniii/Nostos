import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ZalletRpcClient } from "./index.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
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
