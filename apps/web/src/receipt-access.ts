import { createHmac } from "node:crypto";
import { bearerAuthorized } from "./auth.js";

export function receiptAccessConfigured(
  secret: string | undefined,
): secret is string {
  return !!secret && /^[a-f0-9]{64}$/.test(secret);
}
export function receiptToken(paymentId: string, secret: string): string {
  if (!receiptAccessConfigured(secret) || !/^[a-f0-9]{64}$/.test(paymentId))
    throw new Error("Receipt access is not configured");
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`nostos:receipt:v1:${paymentId}`)
    .digest("base64url");
}
export function receiptAuthorized(
  request: Request,
  paymentId: string,
  secret: string,
): boolean {
  return bearerAuthorized(request, receiptToken(paymentId, secret));
}
