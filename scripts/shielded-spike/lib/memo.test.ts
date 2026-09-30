import { describe, expect, it } from "vitest";
import { decodeMemo, encodeMemo } from "./memo.js";

describe("Nostos spike memo", () => {
  it("round trips the locked v1 payload", () => {
    const encoded = encodeMemo("demo-order-001", `utest1${"a".repeat(80)}`);
    expect(decodeMemo({ memo: encoded })).toEqual({
      p: "nostos",
      v: 1,
      o: "demo-order-001",
      r: `utest1${"a".repeat(80)}`,
    });
  });

  it("rejects an unsupported protocol marker", () => {
    const encoded = Buffer.from(
      JSON.stringify({ p: "other", v: 1 }),
      "utf8",
    ).toString("hex");
    expect(() => decodeMemo({ memo: encoded })).toThrow(
      "not a supported Nostos memo",
    );
  });

  it("rejects payloads over the Zcash memo limit", () => {
    expect(() =>
      encodeMemo("demo-order-001", `utest1${"a".repeat(600)}`),
    ).toThrow("exceeds the 512 byte limit");
  });
});
