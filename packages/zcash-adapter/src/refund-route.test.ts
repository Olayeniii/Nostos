import { describe, expect, it, vi } from "vitest";
import { orchardRefundReceiver } from "./refund-route.js";
const address = "utest1" + "b".repeat(80);
describe("Orchard-only refund policy", () => {
  it("uses the wallet-decoded Orchard receiver", async () => {
    const decoder = {
      decodeUnifiedAddress: vi.fn(async () => ({ orchard: address })),
    };
    await expect(orchardRefundReceiver(address, decoder)).resolves.toBe(
      address,
    );
    expect(decoder.decodeUnifiedAddress).toHaveBeenCalledWith(address);
  });
  it.each([
    {},
    { sapling: "zs1fake" },
    { p2pkh: "t1fake" },
    { orchard: "" },
    { orchard: 3 },
    { orchard: "receiver" },
    { orchard: address, p2pkh: "t1fake" },
    { orchard: address, sapling: "zs1fake" },
    { orchard: "u1" + "a".repeat(80) },
  ])("rejects unusable or mixed receivers %j", async (receivers) => {
    const decoder = {
      decodeUnifiedAddress: async () => receivers as Record<string, string>,
    };
    await expect(orchardRefundReceiver(address, decoder)).rejects.toThrow(
      "Orchard-only",
    );
  });
  it.each(["t1fake", "tex1fake", "zs1fake", "not-address"])(
    "rejects %s before RPC",
    async (route) => {
      const decoder = { decodeUnifiedAddress: vi.fn() };
      await expect(orchardRefundReceiver(route, decoder)).rejects.toThrow();
      expect(decoder.decodeUnifiedAddress).not.toHaveBeenCalled();
    },
  );
});
