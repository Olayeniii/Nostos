import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
);

const ignoredDirectories = new Set([
  ".git",
  ".build",
  ".next",
  ".pnpm-store",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function releaseFiles(root = ".") {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !lstatSync(absolute).isSymbolicLink())
        files.push(relative(root, absolute));
    }
  }
  visit(root);
  return files.sort();
}

// A deployed release is created with `git archive`, so it deliberately has no
// Git metadata. In a working tree, keep Git as the source of truth. In an
// isolated release, scan every regular file except dependency and build caches.
const files =
  listed.status === 0
    ? listed.stdout.split("\0").filter(Boolean)
    : releaseFiles();
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
