import {
  loginConfigured,
  newSession,
  passwordMatches,
  sessionHeader,
  validSession,
} from "../../../src/session.js";
import { trustedOrigin } from "../../../src/origin.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// A global bounded attempt budget does not trust spoofable forwarding headers.
let attempts: number[] = [];
export function GET(request: Request) {
  return Response.json({ authenticated: validSession(request) }, { headers });
}
export async function POST(request: Request) {
  if (
    !trustedOrigin(
      request.headers.get("origin"),
      process.env.NOSTOS_WEB_TRUSTED_ORIGINS,
    )
  )
    return Response.json(
      { error: "Request origin rejected" },
      { status: 403, headers },
    );
  if (!loginConfigured())
    return Response.json(
      { error: "Merchant sign in is not configured" },
      { status: 503, headers },
    );
  const now = Date.now();
  attempts = attempts.filter((t) => t > now - 60_000);
  if (attempts.length >= 10)
    return Response.json(
      { error: "Too many attempts. Wait one minute and try again." },
      { status: 429, headers: { ...headers, "Retry-After": "60" } },
    );
  attempts.push(now);
  const text = await request.text();
  if (text.length > 1024)
    return Response.json(
      { error: "Request too large" },
      { status: 413, headers },
    );
  let password: unknown;
  try {
    password = JSON.parse(text).password;
  } catch {
    return Response.json(
      { error: "Invalid request" },
      { status: 400, headers },
    );
  }
  if (typeof password !== "string" || !passwordMatches(password))
    return Response.json(
      { error: "Incorrect password" },
      { status: 401, headers },
    );
  return Response.json(
    { authenticated: true },
    { headers: { ...headers, "Set-Cookie": sessionHeader(newSession()) } },
  );
}
export function DELETE(request: Request) {
  if (
    !trustedOrigin(
      request.headers.get("origin"),
      process.env.NOSTOS_WEB_TRUSTED_ORIGINS,
    )
  )
    return Response.json(
      { error: "Request origin rejected" },
      { status: 403, headers },
    );
  return Response.json(
    { authenticated: false },
    { headers: { ...headers, "Set-Cookie": sessionHeader("") } },
  );
}
