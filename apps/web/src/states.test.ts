import { describe, expect, it } from "vitest";
import { taskPresentation } from "./states.js";

describe("transaction UI states", () => {
  it("keeps waiting explicit and prevents repeat submission", () => {
    expect(taskPresentation("broadcast")).toMatchObject({
      animate: true,
      canSubmit: false,
      retryBlocked: true,
    });
  });
  it("stops motion and blocks retry for unknown outcomes", () => {
    expect(taskPresentation("broadcast_unknown")).toMatchObject({
      animate: false,
      canSubmit: false,
      retryBlocked: true,
    });
  });
  it("stops motion after success and definite failure", () => {
    expect(taskPresentation("confirmed").animate).toBe(false);
    expect(taskPresentation("failed")).toMatchObject({
      animate: false,
      canSubmit: true,
    });
  });
});
