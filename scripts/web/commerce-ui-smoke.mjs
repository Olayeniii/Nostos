/* global document, innerWidth */
// Synthetic API transport. No wallet extension, signing or chain sends.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.NOSTOS_PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.NOSTOS_CHROMIUM_PATH
    ? { executablePath: process.env.NOSTOS_CHROMIUM_PATH }
    : {}),
});
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [],
      calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const id = "11111111-1111-4111-8111-111111111111",
      requestId = "22222222-2222-4222-8222-222222222222",
      token = "t".repeat(43);
    let paid = false,
      decision = "requested",
      claimed = false,
      settled = false;
    const record = () => ({
      id,
      network: "mainnet",
      merchantName: "Synthetic QA store",
      description: "Synthetic commerce payment",
      orderReference: "n_fixture",
      paymentAmountZat: 100000,
      paymentConfirmations: paid ? 3 : 0,
      paymentStatus: paid ? "confirmed" : "unpaid",
      paymentTxid: paid ? "a".repeat(64) : null,
      status: settled ? "confirmed" : "no_refund",
      refundAmountZat: settled ? 40000 : 0,
      remainingAmountZat: settled ? 60000 : 100000,
      confirmedRefundAmountZat: settled ? 40000 : 0,
      pendingRefundAmountZat: 0,
      fulfillment: "pending",
      refundRequests: paid
        ? [
            {
              id: requestId,
              amountZat: 40000,
              reason: "Synthetic customer reason",
              status: settled ? "settled" : decision,
              decisionReason:
                decision === "approved" ? "Merchant approved" : "",
              approvedZat: decision === "approved" ? 40000 : null,
            },
          ]
        : [],
      refunds: [],
    });
    await page.route("**/api/product/**", async (route) => {
      const action = new URL(route.request().url()).pathname.split("/").at(-1);
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
      if (route.request().method() === "POST") calls.push({ action, body });
      let data = {},
        status = 200;
      if (action === "network")
        data = { network: "mainnet", commerceEnabled: true };
      if (action === "me")
        data = {
          merchant: {
            name: "Synthetic QA store",
            ready: true,
            emailVerified: true,
          },
        };
      if (action === "dashboard")
        data = {
          merchant: { name: "Synthetic QA store", ready: true },
          records: [record()],
          syncWarning: false,
          observerPreview: true,
          observerCommerceEnabled: true,
        };
      if (action === "requests") data = { id, token };
      if (action === "checkout")
        data = { receipt: record(), syncWarning: false };
      if (action === "payment-check") {
        assert.equal(body.txid, "a".repeat(64));
        paid = true;
        data = { receipt: record() };
      }
      if (action === "refund-decision") {
        assert.equal(body.decision, "approve");
        decision = "approved";
      }
      if (action === "refund-review")
        data = {
          recipient: "u1" + "r".repeat(60),
          amountZat: 40000,
          memo: "nostos:refund:fixture",
          feeCapZat: 10000,
          handoffStarted: claimed,
        };
      if (action === "refund-handoff") {
        assert.equal(body.password, "synthetic-password");
        assert.equal(claimed, false);
        claimed = true;
        data = {
          recipient: "u1" + "r".repeat(60),
          amountZat: 40000,
          memo: "nostos:refund:fixture",
          feeCapZat: 10000,
          uri: "zcash:u1fixture?amount=0.00040000",
        };
      }
      if (action === "refund-candidate") {
        assert.equal(body.txid, "d".repeat(64));
        data = { saved: true, confirmed: false };
      }
      if (action === "refund-check") {
        settled = true;
        data = { receipt: record() };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    const base = process.env.NOSTOS_UI_BASE_URL ?? "http://127.0.0.1:3107";
    await page.goto(`${base}/merchant#new`);
    await page
      .getByLabel("What is this payment for?", { exact: true })
      .fill("Synthetic item");
    await page.getByLabel("Amount in ZEC", { exact: true }).fill("0.001");
    await page
      .getByRole("button", { name: "Create payment link", exact: true })
      .click();
    await page.getByRole("heading", { name: "Payment link ready" }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "Private payment link", exact: true })
        .inputValue(),
      `${base}/checkout#${token}`,
    );
    await page.goto(`${base}/checkout#${token}`);
    await page
      .getByLabel("Payment transaction ID", { exact: true })
      .fill("a".repeat(64));
    await page
      .getByRole("button", { name: "Verify payment transaction", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your payment is complete." })
      .waitFor();
    await page.goto(`${base}/receipt#${token}`);
    await page.getByText("MAINNET", { exact: true }).waitFor();
    await page.goto(`${base}/merchant#payment=${id}`);
    const panel = page.getByRole("region", {
      name: "Customer refund request",
      exact: true,
    });
    await panel
      .getByLabel("Reason for your decision", { exact: true })
      .fill("Merchant approved");
    await panel
      .getByRole("button", { name: "Review approval", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Save approval", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Review wallet refund", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (process.env.NOSTOS_UI_CAPTURE_DIR)
      await page.screenshot({
        path: `${process.env.NOSTOS_UI_CAPTURE_DIR}/refund-${viewport.width}.png`,
        fullPage: true,
      });
    await panel
      .getByLabel("NOSTOS account password", { exact: true })
      .fill("synthetic-password");
    await panel
      .getByRole("button", { name: "Continue to wallet approval", exact: true })
      .click();
    await panel
      .getByRole("link", { name: "Open refund in wallet", exact: true })
      .waitFor();
    await panel
      .getByLabel("Refund transaction ID", { exact: true })
      .fill("d".repeat(64));
    await panel
      .getByRole("button", { name: "Save transaction reference", exact: true })
      .click();
    await panel.getByText(/Transaction reference saved/).waitFor();
    await panel
      .getByRole("button", { name: "Check refund confirmation", exact: true })
      .click();
    await panel.getByText("Refund confirmed", { exact: true }).waitFor();
    assert.equal(calls.filter((c) => c.action === "refund-handoff").length, 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    JSON.stringify({
      synthetic: true,
      phone: "passed",
      desktop: "passed",
      wallet_started: false,
      sends_requested: 0,
    }) + "\n",
  );
} finally {
  await browser.close();
}
