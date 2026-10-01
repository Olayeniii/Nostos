export interface NostosMemoV1 {
  p: "nostos";
  v: 1;
  o: string;
  r: string;
}

export function encodeMemo(
  orderReference: string,
  refundAddress: string,
): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(orderReference)) {
    throw new Error("Nostos memo contains an invalid order reference.");
  }
  if (!/^(?:utest1|u1)[a-z0-9]{20,}$/u.test(refundAddress)) {
    throw new Error("Nostos memo contains an invalid refund destination.");
  }

  const payload: NostosMemoV1 = {
    p: "nostos",
    v: 1,
    o: orderReference,
    r: refundAddress,
  };
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  if (bytes.length > 512) {
    throw new Error("Nostos memo exceeds the 512 byte limit.");
  }
  return bytes.toString("hex");
}

export function decodeMemo(note: {
  memo?: string;
  memoStr?: string;
}): NostosMemoV1 {
  let plaintext = note.memoStr;
  if (!plaintext && note.memo) {
    const hex = note.memo.replace(/(?:00)+$/u, "");
    plaintext = Buffer.from(hex, "hex").toString("utf8");
  }
  if (!plaintext) throw new Error("Payment note has no readable memo.");

  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("Payment note memo is not valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Nostos memo is invalid.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.p !== "nostos" || candidate.v !== 1) {
    throw new Error("Payment note is not a supported Nostos memo.");
  }
  if (
    typeof candidate.o !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(candidate.o)
  ) {
    throw new Error("Nostos memo contains an invalid order reference.");
  }
  if (
    typeof candidate.r !== "string" ||
    !/^(?:utest1|u1)[a-z0-9]{20,}$/u.test(candidate.r)
  ) {
    throw new Error("Nostos memo contains an invalid refund destination.");
  }

  return candidate as unknown as NostosMemoV1;
}
