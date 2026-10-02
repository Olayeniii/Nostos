export interface ReceiverDecoder {
  decodeUnifiedAddress(address: string): Promise<Record<string, string>>;
}

// The wallet validates the UA encoding and returns a single-receiver Orchard UA.
// This proves receiver capability, not payer ownership or prior non-use.
export async function orchardRefundReceiver(
  address: string,
  decoder: ReceiverDecoder,
): Promise<string> {
  if (!/^(?:utest1|u1)[a-z0-9]{20,500}$/u.test(address))
    throw new Error("A valid Orchard-only unified refund route is required.");
  const receivers = await decoder.decodeUnifiedAddress(address);
  const prefix = address.startsWith("utest1") ? "utest1" : "u1";
  if (
    !receivers ||
    Object.keys(receivers).join(",") !== "orchard" ||
    typeof receivers.orchard !== "string" ||
    !new RegExp(`^${prefix}[a-z0-9]{20,500}$`, "u").test(receivers.orchard)
  )
    throw new Error("A valid Orchard-only unified refund route is required.");
  return receivers.orchard;
}
