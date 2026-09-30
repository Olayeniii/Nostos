import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
);

if (listed.status !== 0) {
  throw new Error("Secret scan could not list repository files.");
}

const files = listed.stdout.split("\0").filter(Boolean);
const forbiddenPaths = [
  /(^|\/)wallet-data(\/|$)/i,
  /(^|\/)zcash-data(\/|$)/i,
  /(^|\/)node-data(\/|$)/i,
  /(^|\/)private-evidence(\/|$)/i,
  /(^|\/)secrets?(\/|$)/i,
  /(^|\/)credentials?(\/|$)/i,
  /(^|\/)\.env($|\.)/i,
  /\.(?:key|pem|p12|keystore|seed|mnemonic|wallet)$/i,
];

const secretPatterns = [
  /(?:PRIVATE_KEY|SPENDING_KEY|VIEWING_KEY|SEED_PHRASE|MNEMONIC)\s*[=:]\s*["']?\S+/i,
  /(?:RPC_PASSWORD|DATA_ENCRYPTION_KEY)\s*[=:]\s*["']?\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
];

const findings = [];

for (const path of files) {
  if (path === ".env.example") continue;
  if (forbiddenPaths.some((pattern) => pattern.test(path))) {
    findings.push(`${path}: forbidden sensitive path`);
    continue;
  }

  const stats = statSync(path);
  if (!stats.isFile() || stats.size > 1_000_000) continue;

  const content = readFileSync(path, "utf8");
  if (content.includes("\u0000")) continue;

  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      findings.push(`${path}: matches ${pattern}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed (${files.length} files checked).`);
}
