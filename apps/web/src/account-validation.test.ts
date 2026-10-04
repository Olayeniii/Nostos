import { describe, expect, it } from "vitest";
import {
  validAccountEmail,
  validAccountPassword,
} from "./account-validation.js";

describe("account input boundaries", () => {
  it("accepts ordinary addresses, subdomains and plus tags", () => {
    for (const email of [
      "accounts@nostos.iyforge.xyz",
      "first.last+store@example.com",
      "o'connor@example.com",
    ])
      expect(validAccountEmail(email)).toBe(true);
  });
  it("rejects markup, control characters, multiple addresses and malformed domains", () => {
    for (const email of [
      "<script>@example.com",
      "a@example.com\r\nBcc: b@example.com",
      "a@example.com,b@example.com",
      "a@@example.com",
      "a@-example.com",
      "a@example-.com",
      "a@example..com",
      ".a@example.com",
      "a..b@example.com",
      "a@example",
      "a b@example.com",
      "a".repeat(65) + "@example.com",
      {},
      null,
    ])
      expect(validAccountEmail(email)).toBe(false);
  });
  it("enforces password length while allowing spaces and punctuation", () => {
    expect(validAccountPassword("a".repeat(11))).toBe(false);
    expect(validAccountPassword("a".repeat(12))).toBe(true);
    expect(validAccountPassword("a".repeat(128))).toBe(true);
    expect(validAccountPassword("a".repeat(129))).toBe(false);
    expect(validAccountPassword("a long passphrase <&>")).toBe(true);
    expect(validAccountPassword({})).toBe(false);
  });
});
