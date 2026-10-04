export function validAccountEmail(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 254) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local = "", domain = ""] = parts;
  if (
    !local ||
    local.length > 64 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  )
    return false;
  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
    )
  );
}

export function validAccountPassword(value: unknown): boolean {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
