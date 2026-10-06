import { describe, it, expect, vi } from "vitest";
import { injectedNoir, NoirHandoff } from "./noir-handoff.js";
const address = "utest1" + "a".repeat(60);
const payment = {
  destination: address,
  amountZat: 2000000,
  memo: JSON.stringify({
    p: "nostos",
    v: 1,
    o: "n_" + "b".repeat(32),
    r: address,
  }),
};
function provider(
  account: unknown = { shielded: address },
  outcome: unknown = "c".repeat(64),
) {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "zcash_requestAccounts") return account;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
}
describe("Noir injected handoff", () => {
  it("detects without account requests, including unavailable and broken injection", () => {
    const rpc = provider();
    expect(
      injectedNoir({ noirwallet: { isNoirWallet: true, zcash: rpc } }),
    ).toBe(rpc);
    expect(rpc.request).not.toHaveBeenCalled();
    expect(injectedNoir({})).toBeUndefined();
    expect(injectedNoir({ noirwallet: { zcash: rpc } })).toBeUndefined();
    expect(
      injectedNoir({
        get noirwallet() {
          throw new Error("private");
        },
      }),
    ).toBeUndefined();
  });
  it("passes the exact original memo, amount and shielded funding once", async () => {
    const rpc = provider(),
      h = new NoirHandoff();
    expect(await h.send(rpc, payment)).toBe("c".repeat(64));
    expect(rpc.request.mock.calls).toEqual([
      [{ method: "zcash_requestAccounts" }],
      [
        {
          method: "zcash_sendTransaction",
          params: [
            {
              to: address,
              amount: "0.02000000",
              memo: payment.memo,
              fundingSource: "shielded",
            },
          ],
        },
      ],
    ]);
    await expect(h.send(rpc, payment)).rejects.toThrow("already in progress");
    expect(rpc.request).toHaveBeenCalledTimes(2);
  });
  it("does not spend if the application's pre-send check fails", async () => {
    const rpc = provider(),
      handoff = new NoirHandoff();
    await expect(
      handoff.send(rpc, payment, async () => {
        throw new Error("private receipt or RPC details");
      }),
    ).rejects.toThrow("No payment was requested");
    expect(handoff.paymentRequested).toBe(false);
    expect(rpc.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { shielded: "u1mainnet" },
    { transparent: "tmtestnet" },
    { shielded: "ztestsapling1fixture" },
  ])(
    "rejects a missing shielded testnet account without sending: %s",
    async (account) => {
      const rpc = provider(account),
        h = new NoirHandoff();
      await expect(h.send(rpc, payment)).rejects.toThrow(
        "No payment was requested",
      );
      expect(rpc.request).toHaveBeenCalledTimes(1);
      expect(h.paymentRequested).toBe(false);
    },
  );
  it.each([new Error("private-route-spending-error"), null, "not-a-txid"])(
    "holds an unknown send outcome without leaking or retrying",
    async (outcome) => {
      const rpc = provider(undefined, outcome),
        h = new NoirHandoff();
      await expect(h.send(rpc, payment)).rejects.not.toThrow(
        "private-route-spending-error",
      );
      expect(h.paymentRequested).toBe(true);
      await expect(h.send(rpc, payment)).rejects.toThrow("already in progress");
      expect(rpc.request).toHaveBeenCalledTimes(2);
    },
  );
  it("does not start overlapping account or spending requests", async () => {
    let finish!: (value: unknown) => void;
    const rpc = {
      request: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const h = new NoirHandoff(),
      first = h.send(rpc, payment);
    await expect(h.send(rpc, payment)).rejects.toThrow("already in progress");
    finish({});
    await expect(first).rejects.toThrow("No payment was requested");
    expect(rpc.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...payment, destination: "tmtransparent" },
    { ...payment, amountZat: 0 },
    { ...payment, amountZat: 1.5 },
    { ...payment, memo: "x".repeat(513) },
    { ...payment, memo: "not-json" },
    {
      ...payment,
      memo: JSON.stringify({
        p: "nostos",
        v: 2,
        o: "n_" + "b".repeat(32),
        r: address,
      }),
    },
    {
      ...payment,
      memo: JSON.stringify({
        p: "nostos",
        v: 1,
        o: "n_" + "b".repeat(32),
        r: "tex1destination",
      }),
    },
  ])("rejects invalid instructions before connecting", async (instructions) => {
    const rpc = provider();
    await expect(new NoirHandoff().send(rpc, instructions)).rejects.toThrow(
      "instructions",
    );
    expect(rpc.request).not.toHaveBeenCalled();
  });
});
