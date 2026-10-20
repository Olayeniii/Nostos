/* global document, window */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(
  (process.env.PLAYWRIGHT_MODULES ||
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) + "/playwright",
);
const phase = process.argv[2] || "after";
const out = `docs/ui-review/${phase}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const base = {
  id: "order-1",
  merchantName: "JaraBot",
  description: "Studio commission",
  orderReference: "n_visual_fixture_001",
  paymentAmountZat: 2000000,
  paymentConfirmations: 12,
  paymentStatus: "confirmed",
  fulfillment: "pending",
  createdAt: "2026-10-18T12:00:00Z",
  paidAt: "2026-10-18T12:10:00Z",
  refundAmountZat: 0,
  confirmedRefundAmountZat: 0,
  remainingAmountZat: 2000000,
  status: "no_refund",
  refunds: [],
  refundRequests: [],
  refundWindowDays: 30,
  canRequestRefund: true,
  payment: {
    id: "p1",
    receivedZat: 2000000,
    refundedZat: 0,
    reservedZat: 0,
    availableZat: 2000000,
    confirmations: 12,
    status: "confirmed",
    canRefund: true,
  },
};
const records = [
  base,
  {
    ...base,
    id: "order-2",
    description: "Website consultation",
    paymentStatus: "awaiting_payment",
    paymentConfirmations: 0,
    paidAt: null,
    payment: undefined,
    canRequestRefund: false,
  },
  {
    ...base,
    id: "order-3",
    description: "Custom print, returned",
    refunds: [{ id: "refund-3", status: "confirmed", amountZat: 1800000 }],
    fulfillment: "fulfilled",
    refundAmountZat: 1800000,
    confirmedRefundAmountZat: 1800000,
    remainingAmountZat: 200000,
    status: "confirmed",
    payment: { ...base.payment, refundedZat: 1800000, availableZat: 200000 },
  },
  {
    ...base,
    id: "order-4",
    description:
      "A very long order name to check wrapping and readable amounts on small screens",
    paymentStatus: "expired",
    paymentConfirmations: 0,
    payment: undefined,
    canRequestRefund: false,
  },
  {
    ...base,
    id: "order-5",
    description: "Refund awaiting confirmation",
    refundAmountZat: 500000,
    pendingRefundAmountZat: 500000,
    status: "broadcast_unknown",
    refunds: [{ id: "f1", status: "broadcast_unknown", amountZat: 500000 }],
    payment: {
      ...base.payment,
      canRefund: false,
      reservedZat: 500000,
      availableZat: 1500000,
    },
  },
  {
    ...base,
    id: "order-6",
    description: "Refund window closed",
    routeClosedReason: "expired",
    payment: { ...base.payment, canRefund: false },
    canRequestRefund: false,
  },
];
const report = [];
for (const width of [320, 375, 390, 430, 768, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  let mode = "populated";
  let customerReceipt = base;
  const posts = [];
  await page.route("**/api/product/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().method() === "POST") posts.push(action);
    if (action === "network")
      return route.fulfill({ json: { network: "testnet" } });
    if (action === "dashboard") {
      if (mode === "error")
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      if (mode === "loading") await new Promise((r) => setTimeout(r, 1500));
      return route.fulfill({
        json: {
          merchant: { name: "JaraBot", ready: true },
          records: mode === "empty" ? [] : records,
          syncWarning: false,
        },
      });
    }
    if (action === "checkout")
      return route.fulfill({
        json: { receipt: customerReceipt, syncWarning: false },
      });
    if (action === "funds")
      return route.fulfill({
        json: {
          network: "testnet",
          spendableZat: 4000000,
          reservedForRefundsZat: 2000000,
          refundFeeAllowanceZat: 10000,
          fundingShortfallZat: 0,
          withdrawableBeforeFeeZat: 1990000,
          spendingBlocked: false,
          history: [],
        },
      });
    if (action === "link")
      return route.fulfill({ json: { token: "a".repeat(43) } });
    return route.fulfill({
      status: 503,
      json: { error: "Fixture blocks mutations" },
    });
  });
  const capture = async (name) => {
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.screenshot({
      path: `${out}/${width}-${name}.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    report.push({ width, state: name, overflow });
    if (phase === "after")
      assert.equal(overflow, false, `${width} ${name} overflows`);
  };
  await page.goto("http://127.0.0.1:3000/merchant");
  await page.getByRole("button", { name: /Studio commission/ }).waitFor();
  await capture("payments");
  if (phase === "after" && width <= 900) {
    assert.equal(
      await page
        .locator(".ledger")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
      "Compact ledger must not require horizontal scrolling",
    );
  }
  await page.getByRole("button", { name: /Studio commission/ }).click();
  await page
    .getByRole("heading", { name: "Studio commission", exact: true })
    .waitFor();
  await capture("detail");
  await page.getByPlaceholder("Enter refund amount").fill("0.005");
  await page
    .getByRole("button", { name: "Review refund", exact: true })
    .click();
  await page.getByRole("heading", { name: "Review private refund" }).waitFor();
  await capture("refund-review");
  assert(!posts.includes("refund"));
  await page
    .getByRole("button", { name: "View payment link", exact: true })
    .click();
  await page.getByRole("heading", { name: "Payment link ready" }).waitFor();
  await capture("payment-link");
  if (phase === "after") {
    for (const record of records.slice(1)) {
      await page.goto("http://127.0.0.1:3000/merchant");
      await page
        .getByRole("button", {
          name: new RegExp(
            record.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        })
        .click();
      await page
        .getByRole("heading", { name: record.description, exact: true })
        .waitFor();
      if (!record.payment?.canRefund) {
        assert.equal(
          await page
            .getByRole("button", { name: "Review refund", exact: true })
            .count(),
          0,
        );
      }
      await capture(`detail-${record.id}`);
      await page
        .getByRole("button", { name: "Back to payments", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Payments", exact: true })
        .waitFor();
    }
  }

  await page.goto("http://127.0.0.1:3000/merchant/funds");
  await page
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .waitFor();
  await capture("funds");
  customerReceipt = records[1];
  await page.goto("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page.getByRole("heading", { name: "JaraBot", exact: true }).waitFor();
  await capture("checkout");
  customerReceipt = base;
  await page.goto("http://127.0.0.1:3000/receipt#" + "a".repeat(43));
  await page.getByText("Private payment receipt").waitFor();
  await capture("receipt");
  await page.goto("http://127.0.0.1:3000/sign-up");
  await page.getByRole("textbox", { name: "Email", exact: true }).waitFor();
  await capture("registration");
  await page.goto("http://127.0.0.1:3000/account-help");
  await page
    .getByRole("heading", { name: "Verify your email", exact: true })
    .waitFor();
  await capture("verification");
  await page.goto("http://127.0.0.1:3000/account-link#" + "a".repeat(43));
  await page
    .getByRole("heading", { name: "Set your password", exact: true })
    .waitFor();
  await capture("set-password");
  for (const state of ["empty", "loading", "error"]) {
    mode = state;
    await page.goto("http://127.0.0.1:3000/merchant");
    if (state === "empty")
      await page
        .getByRole("heading", { name: "Your first payment starts here." })
        .waitFor();
    if (state === "loading")
      await page.getByText("Checking payments", { exact: true }).waitFor();
    if (state === "error")
      await page
        .getByRole("alert")
        .filter({ hasText: "Connection interrupted" })
        .waitFor();
    await capture(state);
  }
  await context.close();
}
await browser.close();
await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
process.stdout.write(`${phase}: ${report.length} responsive states checked\n`);
