export class RequestError extends Error {
  constructor(public readonly status: number) {
    super("Request failed");
  }
}

// The deadline covers headers and body. Aborting a POST does not cancel its server action.
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new RequestError(response.status);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function parseZec(amount: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount) || amount.length > 24)
    return 0;
  const [whole, fraction = ""] = amount.split(".");
  const zat =
    BigInt(whole!) * BigInt(100_000_000) + BigInt(fraction.padEnd(8, "0"));
  return zat <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(zat) : 0;
}

export function matchesReview(
  review: { paymentId: string; amountZat: number } | undefined,
  paymentId: string,
  amountZat: number,
): boolean {
  return (
    !!review && review.paymentId === paymentId && review.amountZat === amountZat
  );
}

export function hasRecordedRefund(record: {
  status: string;
  canRefund: boolean;
  refundTxid?: string;
}): boolean {
  return (
    !record.canRefund &&
    !!record.refundTxid &&
    ["broadcast", "confirmed", "partially_refunded", "refunded"].includes(
      record.status,
    )
  );
}
