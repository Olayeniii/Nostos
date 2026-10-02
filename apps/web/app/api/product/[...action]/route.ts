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
        password.length < 12 ||
        password.length > 128
      )
        return json(
          {
            error:
              "Enter a valid email and a password of 12 to 128 characters.",
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
      let merchant;
      try {
        merchant =
          route === "signup"
            ? store.signup(email, password)
            : store.login(email, password);
      } catch {
        return json(
          { error: "Could not create this account. Try signing in." },
          409,
        );
      }
      if (!merchant)
        return json({ error: "Email or password is incorrect." }, 401);
      return json({ ready: Boolean(merchant.destination) }, 200, {
        "Set-Cookie": accountHeader(store.session(merchant.id)),
      });
    }
    if (route === "checkout" || route === "prepare") {
      const checkout = store.byToken(token(request));
      if (!checkout)
        return json({ error: "Private payment link required" }, 401);
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
    if (route === "me" && !isPost)
      return json({
        merchant: {
          name: merchant.name,
          email: merchant.email,
          ready: Boolean(merchant.destination),
          setupPending: merchant.wallet === "provisioning",
        },
      });
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
                core!.findRefundByPayment(r.paymentTxid)?.status ===
                  "broadcast")),
        )
        .slice(0, 10);
      if (pending.length) {
        try {
          const rpc = wallet();
          const notes = await rpc.listUnspent([merchant.destination]);
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
      if (!id || !value) return json({ error: "Invalid refund" }, 400);
      return json(
        await refundPayment(store, core, merchant, id, value, wallet(120000)),
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
