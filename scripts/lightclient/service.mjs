import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const merchantPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const allowed = new Set([
  "getwalletstatus",
  "z_importviewingkey",
  "z_listunifiedreceivers",
  "nostos_verify_output",
]);
const unresolved = () => new Error("Observer request is unresolved.");
function privateDirectory(path) {
  const m = lstatSync(path);
  if (
    !m.isDirectory() ||
    m.uid !== process.getuid() ||
    m.mode & 0o077 ||
    realpathSync(path) !== path
  )
    throw unresolved();
}

export class PipeWorker {
  busy = false;
  dead = false;
  cache = null;
  #child;
  #pending = null;
  #sequence = 0;
  #buffer = "";
  constructor(binary, root) {
    this.#child = spawn(binary, [root], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin" },
    });
    const fail = () => {
      this.dead = true;
      this.busy = false;
      this.#pending?.reject(unresolved());
      this.#pending = null;
      this.cache = null;
      if (!this.#child.stdin.destroyed && !this.#child.stdin.writableEnded)
        this.#child.stdin.end();
    };
    this.#child.on("error", fail);
    this.#child.on("exit", fail);
    this.#child.stdin.on("error", fail);
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => {
      this.#buffer += chunk;
      if (Buffer.byteLength(this.#buffer) > 16384) {
        fail();
        return;
      }
      let position;
      while ((position = this.#buffer.indexOf("\n")) >= 0) {
        const line = this.#buffer.slice(0, position);
        this.#buffer = this.#buffer.slice(position + 1);
        const pending = this.#pending;
        try {
          const result = JSON.parse(line);
          if (!pending || result.id !== pending.id) {
            fail();
            return;
          }
          this.#pending = null;
          this.busy = false;
          if (result.error || !("result" in result))
            pending.reject(unresolved());
          else pending.resolve(result.result);
        } catch {
          fail();
        }
      }
    });
  }
  request(method, params) {
    if (this.dead || this.busy) return Promise.reject(unresolved());
    this.busy = true;
    return new Promise((resolve, reject) => {
      const id = ++this.#sequence;
      this.#pending = { id, resolve, reject };
      const line = JSON.stringify({ id, method, params }) + "\n";
      if (Buffer.byteLength(line) > 16384) {
        this.#pending = null;
        this.busy = false;
        reject(unresolved());
        return;
      }
      this.#child.stdin.write(line);
    });
  }
  // Closing stdin lets the worker finish its current database operation and exit.
  // A timed-out HTTP request never kills the writer or clears its durable claim.
  close() {
    if (this.dead) return Promise.resolve();
    return new Promise((resolve) => {
      this.#child.once("exit", resolve);
      this.#child.stdin.end();
    });
  }
}

export class ObserverBroker {
  #workers = new Map();
  #root;
  #factory;
  #timer;
  #autoSync;
  constructor({
    root,
    binary,
    factory = (path) => new PipeWorker(binary, path),
    autoSync = true,
  }) {
    privateDirectory(root);
    this.#root = root;
    this.#factory = factory;
    this.#autoSync = autoSync;
    this.#timer = setInterval(() => {
      for (const [id, worker] of this.#workers) {
        if (this.#autoSync && !worker.busy && !worker.dead && worker.connected)
          this.refresh(id).catch(() => {});
      }
    }, 30000);
    this.#timer.unref();
  }
  #worker(id) {
    if (!merchantPattern.test(id)) throw unresolved();
    let worker = this.#workers.get(id);
    if (worker && !worker.dead) return worker;
    if (this.#workers.size >= 8 && !worker) throw unresolved();
    const path = join(this.#root, id);
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw unresolved();
    }
    privateDirectory(path);
    worker = this.#factory(path);
    this.#workers.set(id, worker);
    return worker;
  }
  async request(id, method, params) {
    if (!allowed.has(method)) throw unresolved();
    const worker = this.#worker(id);
    if (method === "getwalletstatus" && worker.busy)
      return {
        ...(worker.cache ?? { node_tip: null }),
        locked: true,
        payments_enabled: false,
      };
    const result = await worker.request(method, params);
    if (method === "getwalletstatus") worker.cache = result;
    if (
      this.#autoSync &&
      !worker.connected &&
      (method === "z_importviewingkey" ||
        (method === "getwalletstatus" && result.account_connected === true))
    ) {
      worker.connected = true;
      const timer = setTimeout(() => this.refresh(id).catch(() => {}), 0);
      timer.unref();
    }
    return result;
  }
  async refresh(id) {
    const worker = this.#worker(id);
    if (worker.busy || worker.dead) throw unresolved();
    try {
      worker.cache = await worker.request("nostos_sync", []);
    } catch {
      worker.cache = null;
      throw unresolved();
    }
  }
  async close() {
    clearInterval(this.#timer);
    await Promise.all(
      [...this.#workers.values()].map((worker) => worker.close()),
    );
  }
}

export function createObserverService({ authorization, broker }) {
  if (!/^Basic [A-Za-z0-9+/=]{20,512}$/.test(authorization)) throw unresolved();
  const expected = createHash("sha256").update(authorization).digest();
  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(value));
      }
    };
    const port = server.address()?.port;
    if (
      request.socket.remoteAddress !== "127.0.0.1" ||
      request.headers.host !== `127.0.0.1:${port}` ||
      request.headers.origin ||
      request.method !== "POST" ||
      request.url !== "/"
    ) {
      send(403, {});
      request.resume();
      return;
    }
    const supplied = createHash("sha256")
      .update(String(request.headers.authorization ?? ""))
      .digest();
    if (!timingSafeEqual(expected, supplied)) {
      send(401, {});
      request.resume();
      return;
    }
    if (request.headers["content-type"] !== "application/json") {
      send(415, {});
      request.resume();
      return;
    }
    let id = null;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) {
          send(413, {});
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !body ||
        body.jsonrpc !== "2.0" ||
        !Number.isSafeInteger(body.id) ||
        body.id <= 0 ||
        !Array.isArray(body.params)
      )
        throw unresolved();
      id = body.id;
      if (!allowed.has(body.method)) {
        send(200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not allowed." },
        });
        return;
      }
      const [merchant, ...params] = body.params;
      if (
        typeof merchant !== "string" ||
        !merchantPattern.test(merchant) ||
        (body.method === "getwalletstatus" && params.length !== 0) ||
        (body.method === "nostos_verify_output" &&
          (params.length !== 9 ||
            !merchantPattern.test(params[0]) ||
            !/^[a-f0-9]{64}$/.test(params[1]) ||
            typeof params[2] !== "string" ||
            params[2].length > 512 ||
            !Number.isSafeInteger(params[3]) ||
            params[3] <= 0 ||
            params[3] > 2100000000000000 ||
            typeof params[4] !== "string" ||
            !/^(?:[a-f0-9]{2}){0,512}$/.test(params[4]) ||
            !["orchard", "ironwood"].includes(params[5]) ||
            !["incoming", "outgoing"].includes(params[6]) ||
            !merchantPattern.test(params[7]) ||
            !Number.isSafeInteger(params[8]) ||
            params[8] < 0 ||
            params[8] > 2100000000000000 ||
            (params[6] === "outgoing" && params[8] === 0))) ||
        (body.method === "z_listunifiedreceivers" &&
          (params.length !== 1 ||
            typeof params[0] !== "string" ||
            params[0].length > 512)) ||
        (body.method === "z_importviewingkey" &&
          (params.length !== 3 ||
            typeof params[0] !== "string" ||
            params[0].length > 3000 ||
            !params[0].startsWith("uview1") ||
            params[1] !== "whenkeyisnew" ||
            !Number.isSafeInteger(params[2]) ||
            params[2] <= 0 ||
            params[2] > 0xffffffff))
      )
        throw unresolved();
      const result = await broker.request(merchant, body.method, params);
      send(200, { jsonrpc: "2.0", id, result });
    } catch {
      send(200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "Observer request is unresolved." },
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}
