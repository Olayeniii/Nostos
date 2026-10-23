/* eslint-disable no-console */
// Synthetic browser transport only. Run against a local production build.
const { chromium } = await import(
  process.env.NOSTOS_PLAYWRIGHT_MODULE ?? "playwright"
);
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.NOSTOS_CHROMIUM_PATH
    ? { executablePath: process.env.NOSTOS_CHROMIUM_PATH }
    : {}),
});
const outcomes = [];
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let network = "mainnet",
      failure = false,
      preview = true,
      checks = [];
    const record = {
      id: "11111111-1111-4111-8111-111111111111",
      description: "Synthetic observer payment",
      orderReference: "fixture-order",
      paymentAmountZat: 100000,
      paymentConfirmations: 0,
      refundAmountZat: 0,
      status: "not_requested",
      paymentStatus: "awaiting_payment",
      createdAt: "2026-10-23T00:00:00Z",
      fulfillment: "pending",
      remainingAmountZat: 100000,
      confirmedRefundAmountZat: 0,
      pendingRefundAmountZat: 0,
      refundRequests: [],
      refunds: [],
    };
    await page.route("**/api/product/**", async (route) => {
      const action = new URL(route.request().url()).pathname.split("/").at(-1);
      let data = {};
      let status = 200;
      if (action === "network") data = { network };
      else if (action === "me")
        data = {
          merchant: {
            name: "Synthetic QA store",
            email: "qa@example.com",
            ready: false,
            setupPending: false,
            refundPolicy: "Refund policy fixture",
            refundWindowDays: 30,
          },
        };
      else if (action === "wallet-connection")
        data = {
          connection: {
            state: "connected",
            network: "mainnet",
            address: "u1" + "b".repeat(60),
          },
        };
      else if (action === "wallet-status") {
        status = failure ? 409 : 200;
        data = failure
          ? { error: "unavailable" }
          : {
              status: {
                state: "ready",
                nodeHeight: 100,
                scannedHeight: 100,
                paymentsEnabled: false,
                signingEnabled: false,
              },
            };
      } else if (action === "dashboard")
        data = {
          merchant: { name: "Synthetic QA store", ready: false },
          records: [record],
          syncWarning: true,
          observerPreview: true,
          observerRecordChecksEnabled: preview,
        };
      else if (action === "observer-payment-check") {
        checks.push(route.request().postDataJSON());
        await new Promise((r) => setTimeout(r, 250));
        status = failure ? 409 : 200;
        data = failure
          ? { error: "unresolved" }
          : { receipt: { ...record, paymentStatus: "confirmed" } };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto(
      `${process.env.NOSTOS_UI_BASE_URL ?? "http://127.0.0.1:3107"}/merchant/settings`,
    );
    const ready = page.getByRole("button", {
      name: "Check wallet sync",
      exact: true,
    });
    await ready.waitFor();
    assert.equal(
      await page.getByText("Hosted by NOSTOS", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByLabel("Unified full viewing key", { exact: true })
        .count(),
      0,
    );
    await ready.click();
    await page
      .getByText(/At the last check, the observer was caught up/)
      .waitFor();
    failure = true;
    await ready.click();
    await page.getByText(/Could not verify current sync readiness/).waitFor();
    assert.equal(
      await page
        .getByText(/At the last check, the observer was caught up/)
        .count(),
      0,
    );
    failure = false;
    await page.goto(
      `${process.env.NOSTOS_UI_BASE_URL ?? "http://127.0.0.1:3107"}/merchant`,
    );
    await page.locator("button.ledger-row").first().click();
    const section = page.getByRole("region", {
      name: "Observer transaction checks",
    });
    const button = section.getByRole("button", {
      name: "Verify payment output",
      exact: true,
    });
    await button.waitFor();
    assert(await button.isDisabled());
    await section
      .getByLabel("Payment transaction reference")
      .fill("a".repeat(64));
    await section.getByLabel("Shielded output pool").selectOption("orchard");
    await button.dblclick();
    await page
      .getByText(
        "Matching confirmed output verified. Saved records have been refreshed.",
      )
      .waitFor();
    assert.equal(checks.length, 1);
    assert.deepEqual(checks[0], {
      id: record.id,
      txid: "a".repeat(64),
      pool: "orchard",
    });
    failure = true;
    await button.click();
    await page.getByText(/The output could not be verified/).waitFor();
    assert.equal(checks.length, 2);
    assert(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    );
    preview = false;
    await page.reload();
    await page.locator("button.ledger-row").first().click();
    assert.equal(
      await page
        .getByRole("region", { name: "Observer transaction checks" })
        .count(),
      0,
    );
    network = "testnet";
    await page.goto(
      `${process.env.NOSTOS_UI_BASE_URL ?? "http://127.0.0.1:3107"}/merchant/settings`,
    );
    await page.getByText("Hosted by NOSTOS", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Check wallet sync", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    outcomes.push({ viewport, passed: true });
    await page.close();
  }
  console.log(JSON.stringify(outcomes));
} finally {
  await browser.close();
}
