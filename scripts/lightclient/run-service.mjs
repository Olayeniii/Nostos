import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createObserverService, ObserverBroker } from "./service.mjs";

function privateFile(path) {
  const m = lstatSync(path);
  if (
    !m.isFile() ||
    m.uid !== process.getuid() ||
    m.mode & 0o077 ||
    m.nlink !== 1 ||
    realpathSync(path) !== path
  )
    throw new Error("Observer configuration is unavailable.");
  return m;
}
export function startConfiguredService(configPath) {
  if (!isAbsolute(configPath) || privateFile(configPath).size > 8192)
    throw new Error("Observer configuration is unavailable.");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    !isAbsolute(config.root ?? "") ||
    !isAbsolute(config.binary ?? "") ||
    !/^[a-f0-9]{64}$/.test(config.binarySha256 ?? "") ||
    !Number.isSafeInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error("Observer configuration is unavailable.");
  const binary = lstatSync(config.binary);
  if (
    !binary.isFile() ||
    (binary.uid !== 0 && binary.uid !== process.getuid()) ||
    binary.mode & 0o022 ||
    !(binary.mode & 0o100) ||
    binary.size > 200_000_000 ||
    realpathSync(config.binary) !== config.binary ||
    createHash("sha256").update(readFileSync(config.binary)).digest("hex") !==
      config.binarySha256
  )
    throw new Error("Observer binary verification failed.");
  for (let path = config.root; ; path = dirname(path)) {
    const m = lstatSync(path);
    if (
      !m.isDirectory() ||
      realpathSync(path) !== path ||
      (m.uid !== 0 && m.uid !== process.getuid()) ||
      (m.mode & 0o022 && !(m.uid === 0 && m.mode & 0o1000))
    )
      throw new Error("Observer storage is unavailable.");
    if (dirname(path) === path) break;
  }
  const root = lstatSync(config.root);
  if (root.uid !== process.getuid() || root.mode & 0o077)
    throw new Error("Observer storage is unavailable.");
  const cookiePath = join(config.root, "service.cookie");
  try {
    writeFileSync(cookiePath, `__nostos__:${randomBytes(32).toString("hex")}`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (privateFile(cookiePath).size > 256)
    throw new Error("Observer credentials are unavailable.");
  const cookie = readFileSync(cookiePath, "utf8").trim();
  if (!/^__nostos__:[a-f0-9]{64}$/.test(cookie))
    throw new Error("Observer credentials are unavailable.");
  const broker = new ObserverBroker({
    root: config.root,
    binary: config.binary,
  });
  const server = createObserverService({
    authorization: `Basic ${Buffer.from(cookie).toString("base64")}`,
    broker,
  });
  server.listen(config.port, "127.0.0.1");
  server.on("error", () => {
    broker.close();
    process.exitCode = 1;
  });
  const close = () => {
    server.close();
    broker.close();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  return { server, close };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    startConfiguredService(process.argv[2] ?? "");
  } catch {
    process.stderr.write("Observer service could not start.\n");
    process.exitCode = 1;
  }
}
