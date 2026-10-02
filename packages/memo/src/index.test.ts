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

describe("memo byte and parsing boundaries", () => {
  const route = "utest1" + "a".repeat(80);
  const valid = JSON.stringify({ p: "nostos", v: 1, o: "order", r: route });
  it.each([
    {},
    { memo: "zz" },
    { memo: "a" },
    { memo: "ff" },
    { memoStr: "{" },
    { memoStr: "null" },
  ])("rejects absent or malformed memo %j", (note) => {
    expect(() => decodeMemo(note)).toThrow();
  });
  it.each([
    { p: "nostos", v: 1, o: "order", r: route, extra: true },
    { p: "nostos", v: 2, o: "order", r: route },
    { p: "nostos", v: 1, o: 3, r: route },
    { p: "nostos", v: 1, o: "order", r: 3 },
    { p: "nostos", v: 1, o: "order", r: "tex1" + "a".repeat(80) },
    { p: "nostos", v: 1, o: "order", r: "t1" + "a".repeat(80) },
  ])("rejects schema or route %j", (payload) => {
    expect(() => decodeMemo({ memoStr: JSON.stringify(payload) })).toThrow();
  });
  it("accepts exactly 512 bytes and rejects 513 on both decode paths", () => {
    const atLimit = valid + " ".repeat(512 - Buffer.byteLength(valid));
    expect(decodeMemo({ memoStr: atLimit }).r).toBe(route);
    expect(decodeMemo({ memo: Buffer.from(atLimit).toString("hex") }).r).toBe(
      route,
    );
    expect(() => decodeMemo({ memoStr: atLimit + " " })).toThrow("512");
    expect(() =>
      decodeMemo({ memo: Buffer.from(atLimit + " ").toString("hex") }),
    ).toThrow("size");
  });
  it("encodes the maximum route allowed by the memo budget", () => {
    const overhead = Buffer.byteLength(
      JSON.stringify({ p: "nostos", v: 1, o: "order", r: "" }),
    );
    const maximum = "utest1" + "a".repeat(512 - overhead - 6);
    expect(Buffer.from(encodeMemo("order", maximum), "hex").length).toBe(512);
    expect(() => encodeMemo("order", maximum + "a")).toThrow("512");
    expect(
      decodeMemo({
        memo:
          encodeMemo("order", route) +
          "00".repeat(512 - Buffer.byteLength(valid)),
      }).r,
    ).toBe(route);
  });
});
