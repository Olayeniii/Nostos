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
    canRequestRefund: false,
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
records.push({
  ...base,
  id: "order-7",
  description: "Customer request to review",
  canRequestRefund: false,
  refundRequests: [
    {
      id: "request-7",
      amountZat: 1000000,
      reason: "Wrong size received",
      status: "requested",
      decisionReason: "",
      approvedZat: null,
      createdAt: "2026-10-18T13:00:00Z",
      decidedAt: null,
    },
  ],
});
const report = [];
for (const width of [320, 375, 390, 430, 768, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const visit = async (url) => {
    // Hash-only changes can keep the old fixture mounted. Begin each scenario
    // with a fresh document; real in-app links are still clicked below.
    await page.goto("about:blank");
    await page.goto(url);
  };
  let mode = "populated";
  let fixtureNetwork = "testnet";
  let setupView = false;
  let customerReceipt = base;
  let customerMode = "normal";
  let releaseCheckout = () => {};
  const posts = [];
  let flowRecord;
  await page.route("**/api/product/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().method() === "POST") posts.push(action);
    if (action === "network")
      return route.fulfill({ json: { network: fixtureNetwork } });
    if (action === "dashboard") {
      if (mode === "error")
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      if (mode === "loading") await new Promise((r) => setTimeout(r, 1500));
      return route.fulfill({
        json: {
          merchant: { name: "JaraBot", ready: true },
          records:
            mode === "empty"
              ? []
              : flowRecord
                ? [flowRecord, ...records]
                : records,
          syncWarning: false,
        },
      });
    }
    if (action === "me")
      return route.fulfill({
        json: {
          merchant: {
            name: "JaraBot",
            email: "merchant@example.test",
            ready: !setupView,
            setupPending: false,
            refundPolicy: "Refunds within 30 days.",
            refundWindowDays: 30,
          },
        },
      });
    if (action === "wallet-connection" && route.request().method() === "GET")
      return route.fulfill({ json: { connection: null } });
    if (action === "checkout") {
      if (customerMode === "error")
        return route.fulfill({
          status: 503,
          json: { error: "Fixture unavailable" },
        });
      if (customerMode === "loading")
        await new Promise((resolve) => {
          releaseCheckout = resolve;
        });
      return route.fulfill({
        json: { receipt: customerReceipt, syncWarning: false },
      });
    }
    if (action === "prepare")
      return route.fulfill({
        json: {
          network: "testnet",
          uri: "zcash:fixture_only?amount=0.02&memo=fixture_memo",
          destination: "utest1" + "a".repeat(250),
          memo: "fixture_memo_" + "m".repeat(300),
          amountZat: 2000000,
        },
      });
    if (action === "requests" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      assert.equal(body.description, "Integrated flow fixture");
      assert.equal(body.amountZat, 2000000);
      flowRecord = {
        ...base,
        id: "flow-order",
        description: body.description,
        orderReference: "n_integrated_flow",
        paymentStatus: "unpaid",
        paymentConfirmations: 0,
        paidAt: null,
        payment: undefined,
        canRequestRefund: false,
      };
      return route.fulfill({
        json: { id: flowRecord.id, token: "b".repeat(43) },
      });
    }
    if (action === "refund-request" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      assert.equal(body.amountZat, 500000);
      assert.equal(body.reason, "Wrong size received");
      flowRecord = {
        ...flowRecord,
        canRequestRefund: false,
        refundRequests: [
          {
            id: body.requestId,
            amountZat: body.amountZat,
            reason: body.reason,
            status: "requested",
            decisionReason: "",
            approvedZat: null,
            createdAt: "2026-10-18T13:00:00Z",
            decidedAt: null,
          },
        ],
      };
      customerReceipt = flowRecord;
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "fulfillment" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      assert.equal(body.id, "flow-order");
      assert.equal(body.state, "fulfilled");
      flowRecord = { ...flowRecord, fulfillment: "fulfilled" };
      customerReceipt = flowRecord;
      return route.fulfill({ json: { ok: true } });
    }
    if (action === "withdrawal-quote" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      assert.equal(body.amountZat, 500000);
      assert.equal(body.destination, "utest1" + "a".repeat(80));
      assert.equal(body.password, "fixture-password-only");
      return route.fulfill({
        json: {
          id: "flow-quote",
          destination: body.destination,
          amountZat: body.amountZat,
          feeZat: 10000,
          network: "testnet",
          expiresAt: Date.now() + 120000,
          status: "review",
          txid: null,
        },
      });
    }
    if (action === "signup") return route.fulfill({ json: { ready: false } });
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
    if (
      process.env.UI_SCREENSHOTS !== "0" &&
      ((width === 1440 && ["payments", "funds", "settings"].includes(name)) ||
        (width === 390 && name === "refunds"))
    ) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${out}/${width}-${name}.png`,
        fullPage: false,
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    report.push({ width, state: name, overflow });
    if (phase === "after")
      assert.equal(overflow, false, `${width} ${name} overflows`);
  };
  await visit("http://127.0.0.1:3000/");
  await page
    .getByRole("heading", { name: "Private payments. A way back." })
    .waitFor();
  await capture("home");
  await visit("http://127.0.0.1:3000/merchant");
  await page.getByRole("button", { name: /Studio commission/ }).waitFor();
  await capture("payments");
  assert.equal(
    await page
      .locator(".summary-grid article")
      .evaluateAll((items) =>
        items.every(
          (item) => window.getComputedStyle(item).display === "block",
        ),
      ),
    true,
    "Summary labels and values must stack inside each metric",
  );

  if (phase === "after") {
    const search = page.getByRole("searchbox", { name: "Find a payment" });
    await search.fill("no-such-order-reference");
    await page.getByRole("heading", { name: "No matching payments" }).waitFor();
    assert.equal(await page.locator(".ledger-row").count(), 0);
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    assert.equal(await page.locator(".ledger-row").count(), records.length);
    await page.getByRole("button", { name: "Confirmed", exact: true }).click();
    assert.equal(
      await page.locator(".ledger-row").count(),
      records.filter((record) => record.paymentStatus === "confirmed").length,
    );
    await page.getByRole("button", { name: "All", exact: true }).click();
  }

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
      await visit("http://127.0.0.1:3000/merchant");
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

  await visit("http://127.0.0.1:3000/merchant/overview");
  await page
    .getByRole("heading", { name: "Your payments, in order." })
    .waitFor();
  await page.locator(".studio-record-list a").first().waitFor();
  assert.equal(
    await page.locator('.studio-rail [aria-current="page"]').textContent(),
    "Overview",
  );
  await capture("overview");
  await page.locator(".studio-record-list a").first().click();
  await page
    .getByRole("heading", { name: "Studio commission", exact: true })
    .waitFor();
  await capture("linked-detail");
  await visit("http://127.0.0.1:3000/merchant/refunds");
  await page.getByRole("heading", { name: "Refunds", exact: true }).waitFor();
  await page.locator(".studio-record-list a").first().waitFor();
  assert.equal(await page.locator(".studio-record-list a").count(), 3);
  await capture("refunds");
  await page
    .locator(".studio-tabs")
    .getByRole("button", { name: /Needs review/ })
    .click();
  assert.equal(await page.locator(".studio-record-list a").count(), 1);
  assert(
    await page
      .locator(".studio-record-state .status-chip")
      .first()
      .evaluate((el) => el.classList.contains("pending")),
    "An unreviewed request must use the waiting state",
  );
  await page.getByRole("link", { name: /Customer request to review/ }).click();
  await page
    .getByRole("heading", { name: "Customer refund request", exact: true })
    .waitFor();
  await capture("linked-customer-request");
  await visit("http://127.0.0.1:3000/merchant/refunds");
  await page.locator(".studio-record-list a").first().waitFor();

  await page
    .locator(".studio-tabs")
    .getByRole("button", { name: /Processing/ })
    .click();
  assert.equal(await page.locator(".studio-record-list a").count(), 1);
  await page
    .getByRole("link", { name: /Refund awaiting confirmation/ })
    .click();
  await page
    .getByRole("heading", { name: "Refund awaiting confirmation", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review refund", exact: true })
      .count(),
    0,
  );
  await capture("linked-unknown-refund");
  await visit("http://127.0.0.1:3000/merchant/settings");
  await page.getByRole("heading", { name: "Merchant profile" }).waitFor();
  assert.equal(
    await page.locator('.studio-rail [aria-current="page"]').textContent(),
    "Settings",
  );
  await capture("settings");
  await visit("http://127.0.0.1:3000/merchant/funds");
  await page
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .waitFor();
  await capture("funds");
  customerReceipt = records[1];
  await visit("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page.getByRole("heading", { name: "JaraBot", exact: true }).waitFor();
  await capture("checkout");
  assert.equal(
    await page.getByRole("textbox", { name: "Email", exact: true }).count(),
    0,
    "Checkout stays accountless",
  );
  await page
    .getByRole("textbox", { name: "Your fresh refund address", exact: true })
    .fill("utest1" + "a".repeat(80));
  await page
    .getByRole("button", { name: "Prepare payment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy complete payment request", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Copy complete payment request", exact: true })
    .click();
  await page.getByText("Payment request copied.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Payment memo", exact: true })
      .inputValue(),
    "fixture_memo_" + "m".repeat(300),
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Merchant payment address", exact: true })
      .inputValue(),
    "utest1" + "a".repeat(250),
  );
  await capture("checkout-prepared");
  customerReceipt = records[3];
  await visit("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page
    .getByRole("heading", { name: "Ask for a new payment link." })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Prepare payment", exact: true })
      .count(),
    0,
  );
  await capture("checkout-expired");
  customerReceipt = base;
  await visit("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page
    .getByRole("heading", { name: "Your payment is complete." })
    .waitFor();
  await capture("checkout-confirmed");
  customerReceipt = records[1];
  customerMode = "loading";
  await visit("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page.getByText("Checking payment request", { exact: true }).waitFor();
  await capture("checkout-loading");
  releaseCheckout();
  customerMode = "error";
  await visit("http://127.0.0.1:3000/checkout#" + "a".repeat(43));
  await page
    .getByRole("alert")
    .filter({ hasText: "Connection interrupted" })
    .waitFor();
  await capture("checkout-error");
  customerMode = "normal";
  await visit("http://127.0.0.1:3000/checkout");
  await page.getByRole("heading", { name: "Payment link required" }).waitFor();
  await capture("checkout-missing-link");

  customerReceipt = base;
  await visit("http://127.0.0.1:3000/receipt#" + "a".repeat(43));
  await page.getByText("Private payment receipt").waitFor();
  await capture("receipt");
  for (const record of [records[2], records[4], records[5], records[6]]) {
    customerReceipt = record;
    await visit("http://127.0.0.1:3000/receipt#" + "a".repeat(43));
    await page.getByText("Private payment receipt").waitFor();
    if (!record.canRequestRefund) {
      assert.equal(
        await page
          .getByRole("button", { name: "Request refund", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByText(
            "Request a full or partial refund from the merchant. No new address is needed. Refunds use the route supplied with this payment.",
            { exact: true },
          )
          .count(),
        0,
      );
    }
    if (record.id === "order-3")
      await page
        .getByRole("heading", { name: "Partially refunded", exact: true })
        .waitFor();
    await capture(`receipt-${record.id}`);
  }
  await visit("http://127.0.0.1:3000/receipt");
  await page
    .getByLabel("Private receipt link", { exact: true })
    .fill("invalid-link");
  await page.getByRole("button", { name: "Open receipt", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Enter the private receipt link" })
    .waitFor();
  await capture("receipt-invalid-link");

  await visit("http://127.0.0.1:3000/sign-up");
  await page.getByRole("textbox", { name: "Email", exact: true }).waitFor();
  await capture("registration");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("review@example.test");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Check your email", exact: true })
    .waitFor();
  await capture("registration-email-sent");
  await visit("http://127.0.0.1:3000/sign-in");
  await page
    .getByRole("heading", { name: "Welcome back", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("review@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fixture-password-only");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Password", { exact: true }).getAttribute("type"),
    "text",
  );
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Sign in is temporarily unavailable" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Resend verification email", exact: true })
      .count(),
    0,
  );
  await capture("sign-in-error");

  await visit("http://127.0.0.1:3000/account-help");
  await page
    .getByRole("heading", { name: "Verify your email", exact: true })
    .waitFor();
  await capture("verification");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("review@example.test");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await page
    .getByText(
      "Could not complete the request. Check the email and try again later.",
      { exact: true },
    )
    .waitFor();
  await capture("verification-error");
  await visit("http://127.0.0.1:3000/account-help?purpose=reset");
  await page
    .getByRole("heading", { name: "Reset your password", exact: true })
    .waitFor();
  await capture("password-reset");

  await visit("http://127.0.0.1:3000/account-link#" + "a".repeat(43));
  await page
    .getByRole("heading", { name: "Set your password", exact: true })
    .waitFor();
  await capture("set-password");

  // Read the latest mainnet setup/consent form without importing view access.
  fixtureNetwork = "mainnet";
  setupView = true;
  await visit("http://127.0.0.1:3000/setup");
  await page
    .getByRole("heading", { name: "Connect your business wallet", exact: true })
    .waitFor();
  await page.getByRole("checkbox", { name: /For SDK preview/ }).waitFor();
  assert.equal(
    await page
      .getByLabel("Unified full viewing key", { exact: true })
      .inputValue(),
    "",
  );
  assert(
    !posts.includes("wallet-connection"),
    "Setup review must not import view access",
  );
  await capture("mainnet-setup-consent");
  fixtureNetwork = "testnet";
  setupView = false;

  // Connected review: every write below is intercepted above; no wallet send.
  await visit("http://127.0.0.1:3000/merchant/overview");
  await page
    .getByRole("link", { name: "Create payment link", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Create payment request", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(
    new URL(page.url()).hash,
    "",
    "Closing creation clears the entry hash",
  );
  await page
    .getByRole("button", { name: "New payment +", exact: true })
    .click();
  await page
    .getByLabel("What is this payment for?", { exact: true })
    .fill("Integrated flow fixture");
  await page.getByLabel("Amount in ZEC", { exact: true }).fill("0.02");
  await page
    .getByRole("button", { name: "Create payment link", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Payment link ready", exact: true })
    .waitFor();
  const checkoutLink = await page
    .getByRole("textbox", { name: "Private payment link", exact: true })
    .inputValue();
  assert.equal(
    checkoutLink,
    "http://127.0.0.1:3000/checkout#" + "b".repeat(43),
  );
  await page
    .getByRole("button", { name: "Copy payment link", exact: true })
    .click();
  await page.getByText("Payment link copied.", { exact: true }).waitFor();
  await capture("flow-created-link");
  customerReceipt = flowRecord;
  await visit(checkoutLink);
  await page
    .getByRole("textbox", { name: "Your fresh refund address", exact: true })
    .fill("utest1" + "a".repeat(80));
  await page
    .getByRole("button", { name: "Prepare payment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy complete payment request", exact: true })
    .waitFor();
  flowRecord = {
    ...flowRecord,
    paymentStatus: "confirmed",
    paymentConfirmations: 12,
    paidAt: base.paidAt,
    payment: { ...base.payment },
    canRequestRefund: true,
  };
  customerReceipt = flowRecord;
  await page
    .getByRole("button", { name: "Check payment", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open your receipt", exact: true })
    .click();
  await page.getByText("Private payment receipt", { exact: true }).waitFor();
  await page
    .getByLabel("Requested refund in ZEC", { exact: true })
    .fill("0.005");
  await page.getByLabel("Reason", { exact: true }).fill("Wrong size received");
  await page
    .getByRole("button", { name: "Request refund", exact: true })
    .click();
  await page.getByText("Awaiting merchant decision", { exact: true }).waitFor();
  await capture("flow-customer-request");
  await visit("http://127.0.0.1:3000/merchant/refunds");
  await page.getByRole("link", { name: /Integrated flow fixture/ }).click();
  await page
    .getByRole("heading", { name: "Integrated flow fixture", exact: true })
    .waitFor();
  await page
    .locator(".studio-rail")
    .getByRole("link", { name: "Payments", exact: true })
    .click();
  await page.getByRole("heading", { name: "Payments", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("complementary", { name: "Payment details", exact: true })
      .count(),
    0,
  );
  assert.equal(
    new URL(page.url()).hash,
    "",
    "Payments menu clears the linked detail",
  );
  await page.reload();
  await page.getByRole("button", { name: /Integrated flow fixture/ }).waitFor();
  assert.equal(
    await page
      .getByRole("complementary", { name: "Payment details", exact: true })
      .count(),
    0,
  );
  await visit("http://127.0.0.1:3000/merchant#payment=flow-order");
  await page
    .getByRole("heading", { name: "Integrated flow fixture", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Mark fulfilled", exact: true })
    .click();
  await page
    .getByText("Merchant-reported state: fulfilled.", { exact: false })
    .waitFor();
  const requestPanel = page.getByRole("region", {
    name: "Customer refund request",
    exact: true,
  });
  await requestPanel
    .getByLabel("Reason for your decision", { exact: true })
    .fill("Approved size return");
  await requestPanel
    .getByRole("button", { name: "Review approval", exact: true })
    .click();
  await requestPanel
    .getByRole("button", { name: "Approve and send 0.005 ZEC", exact: true })
    .waitFor();
  assert(
    !posts.includes("refund-decision"),
    "Reviewing a request must not send a refund",
  );
  await capture("flow-merchant-review");
  await page
    .getByRole("button", { name: "Back to payments", exact: true })
    .click();
  assert.equal(new URL(page.url()).hash, "");
  // Settlement is a returned fixture state, not a browser-triggered send.
  flowRecord = {
    ...flowRecord,
    refundAmountZat: 500000,
    confirmedRefundAmountZat: 500000,
    pendingRefundAmountZat: 0,
    remainingAmountZat: 1500000,
    status: "confirmed",
    canRequestRefund: true,
    refundRequests: flowRecord.refundRequests.map((request) => ({
      ...request,
      status: "settled",
      approvedZat: 500000,
      decisionReason: "Approved size return",
    })),
    refunds: [{ id: "flow-refund", amountZat: 500000, status: "confirmed" }],
    payment: { ...base.payment, refundedZat: 500000, availableZat: 1500000 },
  };
  customerReceipt = flowRecord;
  await visit("http://127.0.0.1:3000/receipt#" + "b".repeat(43));
  await page
    .getByRole("heading", { name: "Partially refunded", exact: true })
    .waitFor();
  await page
    .getByText("fulfilled (merchant reported)", { exact: true })
    .waitFor();
  await page.getByText("Refund confirmed", { exact: true }).first().waitFor();
  await page
    .getByText("Remaining payment value: 0.015 ZEC.", { exact: true })
    .waitFor();
  await capture("flow-settled-receipt");
  await visit("http://127.0.0.1:3000/merchant/funds");
  await page
    .getByLabel("Shielded destination", { exact: true })
    .fill("utest1" + "a".repeat(80));
  await page.getByLabel("Amount in ZEC", { exact: true }).fill("0.005");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("fixture-password-only");
  await page
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Confirm withdrawal", exact: true })
    .waitFor();
  await page
    .getByText("Transaction fee: 0.0001 ZEC. Total debit: 0.0051 ZEC.", {
      exact: true,
    })
    .waitFor();
  await capture("flow-withdrawal-review");
  await page
    .getByRole("button", { name: "Cancel review", exact: true })
    .click();
  assert(
    !posts.includes("withdrawal-confirm"),
    "A withdrawal review must not authorize a send",
  );
  flowRecord = undefined;

  for (const state of ["empty", "loading", "error"]) {
    mode = state;
    await visit("http://127.0.0.1:3000/merchant");
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
    for (const routeName of ["overview", "refunds"]) {
      await visit(`http://127.0.0.1:3000/merchant/${routeName}`);
      if (state === "empty")
        await page
          .getByRole("heading", {
            name:
              routeName === "overview"
                ? "Ready for your first payment."
                : "No refund activity yet.",
          })
          .waitFor();
      if (state === "loading")
        await page
          .getByText(
            routeName === "overview"
              ? "Checking store activity"
              : "Checking refunds",
            { exact: true },
          )
          .waitFor();
      if (state === "error")
        await page
          .getByRole("alert")
          .filter({ hasText: "Connection interrupted" })
          .waitFor();
      await capture(`${routeName}-${state}`);
    }
  }
  assert(
    posts.every((action) =>
      [
        "link",
        "prepare",
        "signup",
        "login",
        "resend-verification",
        "requests",
        "refund-request",
        "fulfillment",
        "withdrawal-quote",
      ].includes(action),
    ),
    "Review only permits explicitly mocked requests, never a refund or withdrawal",
  );
  await context.close();
}
await browser.close();
await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
process.stdout.write(`${phase}: ${report.length} responsive states checked\n`);
