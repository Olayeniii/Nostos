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
  if (plaintext !== undefined && typeof plaintext !== "string")
    throw new Error("Payment note memo is invalid.");
  if (!plaintext && note.memo) {
    if (!/^(?:[a-f0-9]{2}){1,512}$/iu.test(note.memo))
      throw new Error("Payment note memo has invalid hex or size.");
    const hex = note.memo.replace(/(?:00)+$/u, "");
    try {
      plaintext = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(hex, "hex"),
      );
    } catch {
      throw new Error("Payment note memo is not valid UTF-8.");
    }
  }
  if (!plaintext) throw new Error("Payment note has no readable memo.");
  if (Buffer.byteLength(plaintext, "utf8") > 512)
    throw new Error("Nostos memo exceeds the 512 byte limit.");

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
  if (Object.keys(candidate).sort().join(",") !== "o,p,r,v")
    throw new Error("Nostos memo contains unexpected or missing fields.");
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

  return { p: "nostos", v: 1, o: candidate.o, r: candidate.r };
}
