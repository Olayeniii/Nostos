const loopbackOrigins = ["http://127.0.0.1:3000", "http://localhost:3000"];

// Explicit allowlist, never inferred from Host, forwarded headers, or request.url.
export function trustedOrigin(
  origin: string | null,
  configured?: string,
): boolean {
  if (!origin) return false;
  const allowed =
    configured === undefined
      ? loopbackOrigins
      : configured.split(",").map((value) => value.trim());
  return allowed.some((value) => {
    try {
      const url = new URL(value);
      const safe =
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
      return (
        safe &&
        !url.username &&
        !url.password &&
        url.origin === value &&
        origin === value
      );
    } catch {
      return false;
    }
  });
}
