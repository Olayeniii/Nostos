import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestJson,
  parseZec,
  matchesReview,
  hasRecordedRefund,
} from "./requests.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("reviewed amounts", () => {
  it("converts decimals exactly and rejects malformed values", () => {
    expect(parseZec("0.003")).toBe(300000);
    expect(parseZec("0.0031")).toBe(310000);
    expect(parseZec("0.00000001")).toBe(1);
    for (const value of [
      "-1",
      "1e-3",
      "0.000000001",
      "1,000",
      "",
      "90071993",
      " 0.003",
    ])
      expect(parseZec(value)).toBe(0);
  });
  it("requires the same reviewed payment and exact integer amount", () => {
    const review = { paymentId: "payment", amountZat: 300000 };
    expect(matchesReview(review, "payment", parseZec("0.003"))).toBe(true);
    expect(matchesReview(review, "payment", parseZec("0.0031"))).toBe(false);
    expect(matchesReview(review, "other", 300000)).toBe(false);
  });
});
describe("bounded browser requests", () => {
  it("aborts a stalled body without issuing a second request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = requestJson("/api/refunds", { method: "POST" }, 1000);
    const assertion = expect(result).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels a read using the caller signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    );
    const controller = new AbortController();
    const result = requestJson("/api/payments", {}, 1000, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("aborted");
  });
});

it("does not clear a send lock for a confirmed payment without a recorded refund", () => {
  expect(hasRecordedRefund({ status: "confirmed", canRefund: true })).toBe(
    false,
  );
  expect(
    hasRecordedRefund({ status: "broadcast_unknown", canRefund: false }),
  ).toBe(false);
  expect(
    hasRecordedRefund({
      status: "broadcast",
      canRefund: false,
      refundTxid: "fixture",
    }),
  ).toBe(true);
});

it("accepts only known refund check codes and never displays raw server errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "output_unverified",
            error: "private raw memo",
          }),
          { status: 409 },
        ),
    ),
  );
  await expect(
    requestJson("/api/product/refund-check", { method: "POST" }, 1000),
  ).rejects.toMatchObject({
    status: 409,
    code: "output_unverified",
    message: "Request failed",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "private raw memo",
            error: "private raw memo",
          }),
          { status: 503 },
        ),
    ),
  );
  await expect(
    requestJson("/api/product/refund-check", { method: "POST" }, 1000),
  ).rejects.toMatchObject({
    status: 503,
    code: undefined,
    message: "Request failed",
  });
});
