// Keep the tested Node LTS line above the October 2026 security release.
export function assertNodeRuntime(version = process.versions.node) {
  const match = /^24\.(\d+)\.(\d+)$/.exec(version);
  if (
    !match ||
    Number(match[1]) < 22 ||
    (Number(match[1]) === 22 && Number(match[2]) < 1)
  )
    throw new Error("Node 24.22.1 or a newer Node 24 release is required.");
}
