import { randomBytes } from "node:crypto";
import {
  emailConfigured,
  emailMerchant,
  identityLimit,
  issueIdentityToken,
  consumeIdentityToken,
  deliverIdentityEmail,
  reauthenticated,
} from "../../../../src/merchant-identity.js";
import { ProductStore, accountHeader } from "../../../../src/product-store.js";
import { trustedOrigin } from "../../../../src/origin.js";
import {
  coreStore,
  wallet,
  reconcile,
  checkoutView,
  preparePayment,
  setupMerchant,
  newRequest,
  refundPayment,
  requestCustomerRefund,
  decideCustomerRefund,
  recoverOriginalRefundRoute,
} from "../../../../src/product-service.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (value: unknown, status = 200, extra = {}) =>
  Response.json(value, { status, headers: { ...headers, ...extra } });
const attempts = new Map<string, { count: number; expires: number }>();
function limit(key: string, max: number) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.expires <= now) attempts.delete(k);
  const value = attempts.get(key) ?? { count: 0, expires: now + 600000 };
  value.count++;
  attempts.set(key, value);
  return value.count <= max;
}
function text(value: unknown, min: number, max: number) {
  return typeof value === "string" &&
    value.trim().length >= min &&
    value.trim().length <= max
    ? value.trim()
    : undefined;
}
function amount(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 100000000
    ? value
    : undefined;
}
function action(request: Request) {
  return new URL(request.url).pathname.split("/").at(-1);
}
function token(request: Request) {
  return /^Bearer [A-Za-z0-9_-]{43}$/.test(
    request.headers.get("authorization") ?? "",
  )
    ? request.headers.get("authorization")!.slice(7)
    : "";
}
async function handle(request: Request) {
  let store: ProductStore | undefined;
  let core: ReturnType<typeof coreStore> | undefined;
  try {
    store = new ProductStore();
    core = coreStore(store);
    const route = action(request);
    const isPost = request.method === "POST";
    if (
      isPost &&
      !trustedOrigin(
        request.headers.get("origin"),
        process.env.NOSTOS_WEB_TRUSTED_ORIGINS,
      )
    )
      return json({ error: "Request origin rejected" }, 403);
    let body: Record<string, unknown> = {};
    if (isPost) {
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: "Request too large" }, 413);
      try {
        body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
    }
    if (isPost && (route === "signup" || route === "login")) {
      const email = text(body.email, 3, 254)?.toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (
        !email ||
        !/^\S+@\S+\.\S+$/.test(email) ||
        (route === "login" && (password.length < 12 || password.length > 128))
      )
        return json(
          {
            error:
              route === "signup"
                ? "Enter a valid email."
                : "Enter a valid email and a password of 12 to 128 characters.",
          },
          400,
        );
      // No trust in forwarded client IP. Global + email limits apply through the reverse proxy.
      if (!limit("credentials", 100) || !limit(email, 10))
        return json(
          { error: "Too many attempts. Try again in ten minutes." },
          429,
        );
      if (route === "signup" && !limit("signup", 10))
        return json({ error: "Account creation is temporarily limited." }, 429);
      if (route === "signup") {
        if (!emailConfigured())
          return json({ error: "Account email delivery is unavailable." }, 503);
        if (!identityLimit(store, "global", 30) || !identityLimit(store, email))
          return json({ error: "Try again in fifteen minutes." }, 429);
        let merchant = emailMerchant(store, email);
        // No usable password until the email owner completes verification.
        if (!merchant)
          merchant = store.signup(email, randomBytes(32).toString("base64url"));
        if (!merchant.emailVerifiedAt) {
          const verification = issueIdentityToken(
            store,
            merchant.id,
            "verify",
            email,
          );
          try {
            await deliverIdentityEmail(email, verification, "verify");
          } catch {
            return json(
              { error: "Account email delivery is unavailable." },
              503,
            );
          }
        }
        return json({
          message:
            "If verification is needed, an email has been sent. Check your inbox.",
        });
      }
      const merchant = store.login(email, password);
      if (!merchant)
        return json({ error: "Email or password is incorrect." }, 401);
      if (!merchant.emailVerifiedAt)
        return json(
          {
            error: "Verify your email before signing in.",
            verificationRequired: true,
          },
          403,
        );
      return json({ ready: Boolean(merchant.destination) }, 200, {
        "Set-Cookie": accountHeader(store.session(merchant.id)),
      });
    }
    if (
      isPost &&
      ["resend-verification", "recover-password"].includes(route ?? "")
    ) {
      const email = text(body.email, 3, 254)?.toLowerCase();
      if (!email || !/^\S+@\S+\.\S+$/.test(email))
        return json({ error: "Enter a valid email." }, 400);
      if (!emailConfigured())
        return json({ error: "Account email delivery is unavailable." }, 503);
      if (!identityLimit(store, "global", 30) || !identityLimit(store, email))
        return json({ error: "Try again in fifteen minutes." }, 429);
      const merchant = emailMerchant(store, email);
      const purpose = route === "recover-password" ? "reset" : "verify";
      if (
        merchant &&
        (purpose === "reset"
          ? !!merchant.emailVerifiedAt
          : !merchant.emailVerifiedAt)
      ) {
        const token = issueIdentityToken(store, merchant.id, purpose, email);
        try {
          await deliverIdentityEmail(email, token, purpose);
        } catch {
          return json({ error: "Account email delivery is unavailable." }, 503);
        }
      }
      return json({
        message: "If this account is eligible, an email has been sent.",
      });
    }
    if (isPost && route === "account-link") {
      if (!identityLimit(store, "consume", 60))
        return json({ error: "Try again later." }, 429);
      try {
        const merchant = consumeIdentityToken(
          store,
          String(body.token ?? ""),
          String(body.password ?? ""),
        );
        return json({ ready: Boolean(merchant.destination) }, 200, {
          "Set-Cookie": accountHeader(store.session(merchant.id)),
        });
      } catch {
        return json(
          {
            error:
              "This link expired, was used, or is unavailable. Request another email.",
          },
          400,
        );
      }
    }

    if (
      route === "checkout" ||
      route === "prepare" ||
      route === "refund-request"
    ) {
      const checkout = store.byToken(token(request));
      if (!checkout)
        return json({ error: "Private payment link required" }, 401);
      if (route === "refund-request" && isPost) {
        const id = text(body.requestId, 36, 36);
        const value = amount(body.amountZat);
        const reason = text(body.reason, 3, 1000);
        if (
          !id ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
            id,
          ) ||
          !value ||
          !reason ||
          Object.keys(body).some(
            (k) => !["requestId", "amountZat", "reason"].includes(k),
          )
        )
          return json({ error: "Enter a refund amount and reason." }, 400);
        const created = requestCustomerRefund(
          store,
          core,
          checkout,
          id,
          value,
          reason,
        );
        return json({
          requestId: created.id,
          receipt: checkoutView(store, core, store.checkout(checkout.id)!),
        });
      }
      if (route === "prepare" && isPost) {
        const route = text(body.route, 20, 506);
        if (!route)
          return json({ error: "Enter a fresh testnet refund address" }, 400);
        return json(await preparePayment(store, checkout, route, wallet()));
      }
      if (route === "checkout" && !isPost) {
        let syncWarning = false;
        try {
          await reconcile(store, core, checkout, wallet());
        } catch {
          syncWarning = true;
        }
        return json({
          receipt: checkoutView(store, core, store.checkout(checkout.id)!),
          syncWarning,
        });
      }
      return json({ error: "Method unavailable" }, 405);
    }
    const merchant = store.authenticate(request);
    if (!merchant) return json({ error: "Sign in required" }, 401);
    if (route === "change-email" && isPost) {
      const email = text(body.email, 3, 254)?.toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      if (
        !email ||
        !/^\S+@\S+\.\S+$/.test(email) ||
        password.length > 128 ||
        !reauthenticated(store, merchant.id, password)
      )
        return json(
          { error: "Check the new email and current password." },
          400,
        );
      if (!emailConfigured())
        return json({ error: "Account email delivery is unavailable." }, 503);
      if (
        !identityLimit(store, "global", 30) ||
        !identityLimit(store, merchant.id + ":email")
      )
        return json({ error: "Try again in fifteen minutes." }, 429);
      if (!emailMerchant(store, email)) {
        const token = issueIdentityToken(store, merchant.id, "email", email);
        try {
          await deliverIdentityEmail(email, token, "email");
        } catch {
          return json({ error: "Account email delivery is unavailable." }, 503);
        }
      }
      return json({
        message:
          "If the new email is available, a verification link has been sent. Your current email remains active until verification.",
      });
    }
    if (route === "fulfillment" && isPost) {
      const checkout = store.checkout(String(body.id ?? ""));
      if (
        !checkout ||
        checkout.merchantId !== merchant.id ||
        checkout.status !== "confirmed" ||
        !["pending", "fulfilled", "failed"].includes(String(body.state))
      )
        return json(
          { error: "Confirmed payment and valid fulfillment state required." },
          400,
        );
      store.db
        .prepare("UPDATE checkouts SET fulfillment=? WHERE id=?")
        .run(String(body.state), checkout.id);
      return json({ ok: true });
    }
    if (route === "me" && !isPost)
      return json({
        merchant: {
          name: merchant.name,
          email: merchant.email,
          emailVerified: true,
          ready: Boolean(merchant.destination),
          setupPending: merchant.wallet === "provisioning",
          refundPolicy: merchant.refundPolicy,
          refundWindowDays: merchant.refundWindowDays,
        },
      });
    if (route === "policy" && isPost) {
      const policy = text(body.policy, 3, 1000);
      const days = body.windowDays;
      if (
        !policy ||
        !(
          days === null ||
          (typeof days === "number" &&
            Number.isInteger(days) &&
            days >= 1 &&
            days <= 365)
        )
      )
        return json(
          {
            error:
              "Enter a policy and a window from 1 to 365 days, or no deadline.",
          },
          400,
        );
      store.setRefundPolicy(merchant.id, policy, days);
      return json({ ok: true });
    }
    if (route === "recover-route" && isPost) {
      const id = text(body.id, 36, 36);
      if (!id) return json({ error: "Invalid payment." }, 400);
      return json(
        await recoverOriginalRefundRoute(
          store,
          core,
          merchant,
          id,
          wallet(15000),
        ),
      );
    }
    if (route === "refund-decision" && isPost) {
      const id = text(body.requestId, 36, 36);
      const reason = text(body.reason, 3, 1000);
      const decision =
        body.decision === "approve"
          ? "approved"
          : body.decision === "decline"
            ? "declined"
            : undefined;
      const value = amount(body.amountZat);
      if (!id || !reason || !decision || (decision === "approved" && !value))
        return json(
          { error: "Enter a decision, reason and approval amount." },
          400,
        );
      return json(
        await decideCustomerRefund(
          store,
          core,
          merchant,
          id,
          decision,
          reason,
          value,
          wallet(120000),
        ),
      );
    }
    if (route === "logout" && isPost) {
      store.logout(request);
      return json({ ok: true }, 200, { "Set-Cookie": accountHeader("") });
    }
    if (route === "setup" && isPost) {
      const name = text(body.name, 2, 80);
      if (!name) return json({ error: "Enter your store name" }, 400);
      await setupMerchant(store, merchant, name, wallet());
      return json({ ok: true });
    }
    if (route === "link" && isPost) {
      const id = text(body.id, 36, 36);
      const token = id ? store.receiptToken(id, merchant.id) : undefined;
      return token ? json({ token }) : json({ error: "Not found" }, 404);
    }
    if (route === "requests" && isPost) {
      const description = text(body.description, 2, 160);
      const value = amount(body.amountZat);
      if (!description || !value)
        return json(
          { error: "Enter a description and an amount up to 1 testnet ZEC" },
          400,
        );
      return json(newRequest(store, merchant, description, value));
    }
    if (route === "dashboard" && !isPost) {
      const requests = store.requests(merchant.id);
      let syncWarning = false;
      // Serial, bounded scan of this merchant's requests. Saved records stay readable during RPC failures.
      const pending = requests
        .filter(
          (r) =>
            r.route &&
            (r.status !== "confirmed" ||
              (r.paymentTxid &&
                ["broadcast", "confirmed"].includes(
                  core!.findRefundByPayment(r.paymentTxid)?.status ?? "",
                ))),
        )
        .slice(0, 10);
      if (pending.length) {
        try {
          const rpc = wallet();
          const notes = await rpc.listUnspent();
          const results = await Promise.allSettled(
            pending.map((r) => reconcile(store!, core!, r, rpc, notes)),
          );
          syncWarning = results.some((r) => r.status === "rejected");
        } catch {
          syncWarning = true;
        }
      }
      return json({
        merchant: { name: merchant.name, ready: Boolean(merchant.destination) },
        records: store
          .requests(merchant.id)
          .map((r) => checkoutView(store!, core!, r, true)),
        syncWarning,
      });
    }
    if (route === "refund" && isPost) {
      const id = text(body.id, 36, 36);
      const value = amount(body.amountZat);
      const instructionId = text(body.instructionId, 36, 36);
      if (
        !id ||
        !value ||
        !instructionId ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
          instructionId,
        )
      )
        return json(
          { error: "Refresh and review a new refund instruction." },
          400,
        );
      return json(
        await refundPayment(
          store,
          core,
          merchant,
          id,
          value,
          wallet(120000),
          instructionId,
        ),
      );
    }
    return json({ error: "Not found" }, 404);
  } catch {
    // Raw wallet/SQLite errors can contain private memos, destinations or identities.
    return json(
      {
        error:
          "Could not complete this request. Refresh the recorded status before taking action.",
      },
      503,
    );
  } finally {
    core?.close();
    store?.close();
  }
}
export const GET = handle;
export const POST = handle;
