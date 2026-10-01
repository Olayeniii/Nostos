import { describe, expect, it } from "vitest";
import { decodeMemo, encodeMemo } from "./index.js";

describe("Nostos memo schema", () => {
  it("round trips the versioned payload", () => {
    const refundAddress = `utest1${"a".repeat(80)}`;
    expect(
      decodeMemo({ memo: encodeMemo("order_001", refundAddress) }),
    ).toEqual({
      p: "nostos",
      v: 1,
      o: "order_001",
      r: refundAddress,
    });
  });

  it("rejects malformed destinations before encoding", () => {
    expect(() => encodeMemo("order_001", "not-an-address")).toThrow(
      "invalid refund destination",
    );
  });

  it("rejects arrays and unsupported protocol versions", () => {
    expect(() => decodeMemo({ memoStr: "[]" })).toThrow("invalid");
    expect(() =>
      decodeMemo({ memoStr: JSON.stringify({ p: "nostos", v: 2 }) }),
    ).toThrow("not a supported Nostos memo");
  });
});
