import { timingSafeEqual } from "node:crypto";

export function authorized(
  request: Request,
  token: string | undefined,
): boolean {
  if (!token || !request.headers.get("authorization")?.startsWith("Bearer "))
    return false;
  const provided = Buffer.from(request.headers.get("authorization")!.slice(7));
  const expected = Buffer.from(token);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
