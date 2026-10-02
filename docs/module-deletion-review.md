# Deletion test during the product and receipt cleanup

Reviewed using Matt Pocock's `codebase-design` vocabulary. A small implementation alone is not evidence that a module should be removed. The question is whether deleting it removes complexity or distributes that complexity into callers.

## Candidate: `authorized` in `apps/web/src/auth.ts`

Small wrapper around cookie and bearer authentication. Two real production call sites:

Before, `apps/web/app/api/payments/route.ts`:

```ts
if (!authorized(request, process.env.NOSTOS_WEB_TOKEN))
  return Response.json({ error: "Merchant access required" }, { status: 401 });
```

After removal, the same call site would require:

```ts
const token = process.env.NOSTOS_WEB_TOKEN;
const permitted =
  !!token &&
  (request.headers.has("authorization")
    ? bearerAuthorized(request, token)
    : validSession(request));
if (!permitted)
  return Response.json({ error: "Merchant access required" }, { status: 401 });
```

Before, `apps/web/app/api/refunds/route.ts`:

```ts
if (!authorized(request, process.env.NOSTOS_WEB_TOKEN))
  return Response.json({ error: "Merchant access required" }, { status: 401 });
```

After removal, that call site would also require:

```ts
const token = process.env.NOSTOS_WEB_TOKEN;
const permitted =
  !!token &&
  (request.headers.has("authorization")
    ? bearerAuthorized(request, token)
    : validSession(request));
if (!permitted)
  return Response.json({ error: "Merchant access required" }, { status: 401 });
```

Behavior moved into both callers: reject missing server configuration; prefer explicit Authorization over cookie authentication; do not fall back to a valid cookie after an invalid explicit bearer token. Both callers also gain imports for the cookie and bearer implementations.

Decision: retain. Deletion distributes authentication policy across payment reads and refund writes. These are proposed after-removal examples, not changes applied to the code.

## Candidate: `accountHeader` in `apps/web/src/product-store.ts`

A short cookie formatting function. Two real production call sites in `apps/web/app/api/product/[...action]/route.ts`:

Before, successful signup/sign-in:

```ts
return json({ ready: Boolean(merchant.destination) }, 200, {
  "Set-Cookie": accountHeader(store.session(merchant.id)),
});
```

After removal:

```ts
const token = store.session(merchant.id);
return json({ ready: Boolean(merchant.destination) }, 200, {
  "Set-Cookie": `__Host-nostos-account=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
});
```

Before, sign-out:

```ts
store.logout(request);
return json({ ok: true }, 200, { "Set-Cookie": accountHeader("") });
```

After removal:

```ts
store.logout(request);
return json({ ok: true }, 200, {
  "Set-Cookie":
    "__Host-nostos-account=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
});
```

Behavior moved into callers: cookie name, host-only prefix constraints, root path, Secure, HttpOnly, SameSite and creation/deletion lifetime. Database session revocation remains in `store.logout`; it is not performed by this helper.

Decision: retain. A cookie creation/deletion mismatch would break sign-out or weaken session protection. Again, after-removal examples are hypothetical.

## Cleanup applied

Removed the unused hosted-customer-broadcast and faucet-budget scaffolding introduced while evaluating checkout. Customers pay from their own wallet; this product must not silently spend the operator's customer wallet balance. Those methods had zero real callers, so they do not qualify for two-call-site examples.

Removed the superseded stylesheet layers for the old payment-row, operator sign-in, demo role switch and static entry composition. Current application primitives and product layouts now have one stylesheet definition, preserving the locked logo and motion rules.

No security helper was deleted merely to reduce the module count. Future deletion candidates must identify two real callers, preserve error and ordering semantics, and show what complexity moves before removal.
