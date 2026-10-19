import { afterEach, expect, it, vi } from "vitest";
import { MerchantCustodyError } from "./custody-policy.js";
import {
  wallet,
  setupMerchant,
  newRequest,
  preparePayment,
  refundPayment,
} from "./product-service.js";
import {
  merchantFunds,
  quoteWithdrawal,
  confirmWithdrawal,
} from "./merchant-funds.js";

// Any access would be a store mutation, account creation, credential read, or
// wallet call before rejecting the unsupported custody model.
const touched = vi.fn(() => {
  throw new Error("Unexpected dependency access");
});
const dependency = new Proxy({}, { get: touched }) as never;
afterEach(() => {
  vi.unstubAllEnvs();
  touched.mockClear();
});
it.each([
  ["wallet client", () => wallet()],
  [
    "merchant setup",
    () => setupMerchant(dependency, dependency, "Store", dependency),
  ],
  [
    "payment request",
    () => newRequest(dependency, dependency, "Order", 100000),
  ],
  [
    "payment instructions",
    () => preparePayment(dependency, dependency, "u1example", dependency),
  ],
  [
    "refund",
    () =>
      refundPayment(
        dependency,
        dependency,
        dependency,
        "checkout",
        100000,
        dependency,
      ),
  ],
  [
    "funds",
    () =>
      merchantFunds(dependency, dependency, dependency, dependency, dependency),
  ],
  [
    "withdrawal review",
    () =>
      quoteWithdrawal(
        dependency,
        dependency,
        dependency,
        "u1example",
        100000,
        dependency,
        dependency,
      ),
  ],
  [
    "withdrawal signing",
    () =>
      confirmWithdrawal(
        dependency,
        dependency,
        dependency,
        "review",
        dependency,
        dependency,
      ),
  ],
] as const)(
  "blocks hosted mainnet %s before side effects",
  async (_, operation) => {
    vi.stubEnv("NOSTOS_NETWORK", "mainnet");
    await expect(
      Promise.resolve().then(async () => {
        await operation();
      }),
    ).rejects.toBeInstanceOf(MerchantCustodyError);
    expect(touched).not.toHaveBeenCalled();
  },
);
