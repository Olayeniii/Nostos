import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

export interface HelperConfig {
  binary: string;
  binarySha256: string;
  walletRoot: string;
}
export interface VerifiedControl {
  readonly observation: Readonly<{
    chain: "mainnet";
    pool: "ironwood";
    accountBinding: string;
    receiverBinding: string;
    memoBinding: string;
    amountZat: number;
    feeZat: number;
    txid: string;
    outputIndex: number;
    blockHeight: number;
    blockHash: string;
    confirmations: number;
  }>;
  readonly tipHeight: number;
  readonly tipHash: string;
  readonly grossInputZat: number;
  readonly nonce: string;
}
const issued = new WeakSet<object>();
export function isVerifiedControl(value: unknown): value is VerifiedControl {
  return typeof value === "object" && value !== null && issued.has(value);
}
export function consumeVerifiedControl(value: VerifiedControl): boolean {
  return issued.delete(value);
}
function refused(): never {
  throw new Error("Private control verification refused.");
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refused();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== [...keys].sort().join()) refused();
  return v;
}
function hex(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) refused();
  return value;
}
function integer(value: unknown, min: number, max = 0xffff_ffff): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    refused();
  return value;
}
function helper(
  config: HelperConfig,
  input: Record<string, unknown>,
): { result: unknown; nonce: string } {
  try {
    const info = lstatSync(config.binary);
    if (
      !isAbsolute(config.binary) ||
      !isAbsolute(config.walletRoot) ||
      !info.isFile() ||
      info.uid !== process.getuid!() ||
      info.nlink !== 1 ||
      info.mode & 0o022 ||
      !(info.mode & 0o100) ||
      createHash("sha256").update(readFileSync(config.binary)).digest("hex") !==
        hex(config.binarySha256)
    )
      refused();
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 16_384) refused();
    const secret = randomBytes(32);
    const nonce = randomBytes(32).toString("hex");
    const child = spawnSync(config.binary, [config.walletRoot], {
      input: JSON.stringify({
        body,
        sessionKey: secret.toString("hex"),
        nonce,
      }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 600_000,
      killSignal: "SIGKILL",
      maxBuffer: 16_384,
      env: { LANG: "C", NODE_ENV: "production" },
    });
    if (child.status !== 0 || child.error) refused();
    const envelope = object(JSON.parse(child.stdout), ["payload", "mac"]);
    if (
      typeof envelope.payload !== "string" ||
      envelope.payload.length > 12_000
    )
      refused();
    const expected = createHmac("sha256", secret)
      .update(envelope.payload)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(hex(envelope.mac), "hex")))
      refused();
    const response = object(JSON.parse(envelope.payload), [
      "nonce",
      "requestDigest",
      "mode",
      "result",
    ]);
    if (
      response.nonce !== nonce ||
      response.mode !== input.mode ||
      response.requestDigest !== createHash("sha256").update(body).digest("hex")
    )
      refused();
    return { result: response.result, nonce };
  } catch {
    return refused();
  }
}

export function prepareWithHelper(
  config: HelperConfig,
  input: Record<string, unknown>,
) {
  const { result } = helper(config, { ...input, mode: "prepare" });
  const value = object(result, [
    "accountBinding",
    "receiverBinding",
    "memoBinding",
    "receiver",
    "reference",
    "birthday",
  ]);
  if (
    typeof value.receiver !== "string" ||
    !/^u1[a-z0-9]{20,500}$/.test(value.receiver) ||
    value.reference !== input.reference ||
    value.birthday !== input.birthday
  )
    refused();
  return Object.freeze({
    accountBinding: hex(value.accountBinding),
    receiverBinding: hex(value.receiverBinding),
    memoBinding: hex(value.memoBinding),
    receiver: value.receiver,
    reference: String(value.reference),
    birthday: integer(value.birthday, 1),
  });
}

export function preflightWithHelper(
  config: HelperConfig,
  input: Record<string, unknown>,
) {
  const { result } = helper(config, { ...input, mode: "preflight" });
  const value = object(result, [
    "accountBinding",
    "receiverBinding",
    "memoBinding",
    "fundingReady",
  ]);
  if (value.fundingReady !== true) refused();
  return Object.freeze({
    accountBinding: hex(value.accountBinding),
    receiverBinding: hex(value.receiverBinding),
    memoBinding: hex(value.memoBinding),
  });
}

export function verifyWithHelper(
  config: HelperConfig,
  input: Record<string, unknown>,
): VerifiedControl {
  object(input, [
    "receiver",
    "reference",
    "bindingKey",
    "txid",
    "maxFeeZat",
    "maxDebitZat",
    "minConfirmations",
  ]);
  hex(input.bindingKey);
  hex(input.txid);
  integer(input.maxFeeZat, 1, 10_000);
  integer(input.maxDebitZat, 10_001, 20_000);
  integer(input.minConfirmations, 3, 100);
  const { result, nonce } = helper(config, { ...input, mode: "verify" });
  const value = object(result, [
    "observation",
    "tipHeight",
    "tipHash",
    "grossInputZat",
  ]);
  const o = object(value.observation, [
    "chain",
    "pool",
    "accountBinding",
    "receiverBinding",
    "memoBinding",
    "amountZat",
    "feeZat",
    "txid",
    "outputIndex",
    "blockHeight",
    "blockHash",
    "confirmations",
  ]);
  if (
    o.chain !== "mainnet" ||
    o.pool !== "ironwood" ||
    o.txid !== input.txid ||
    o.amountZat !== 10_000
  )
    refused();
  const observation = Object.freeze({
    chain: "mainnet" as const,
    pool: "ironwood" as const,
    accountBinding: hex(o.accountBinding),
    receiverBinding: hex(o.receiverBinding),
    memoBinding: hex(o.memoBinding),
    amountZat: 10_000,
    feeZat: integer(o.feeZat, 0, 10_000),
    txid: hex(o.txid),
    outputIndex: integer(o.outputIndex, 0),
    blockHeight: integer(o.blockHeight, 1),
    blockHash: hex(o.blockHash),
    confirmations: integer(o.confirmations, 3),
  });
  const tipHeight = integer(value.tipHeight, observation.blockHeight);
  const grossInputZat = integer(
    value.grossInputZat,
    10_000 + observation.feeZat,
    20_000,
  );
  if (
    observation.confirmations !== tipHeight - observation.blockHeight + 1 ||
    observation.feeZat > Number(input.maxFeeZat) ||
    grossInputZat > Number(input.maxDebitZat) ||
    observation.confirmations < Number(input.minConfirmations)
  )
    refused();
  const checked = Object.freeze({
    observation,
    tipHeight,
    tipHash: hex(value.tipHash),
    grossInputZat,
    nonce,
  });
  issued.add(checked);
  return checked;
}
