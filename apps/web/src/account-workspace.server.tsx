import "server-only";
import { cookies } from "next/headers";
import { accountCookie, ProductStore } from "./product-store.js";

// Validate the existing session without creating, extending, or deleting it.
export async function accountWorkspace() {
  const jar = await cookies();
  const values = jar.getAll(accountCookie);
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0]!.value))
    return undefined;
  const store = new ProductStore();
  try {
    const merchant = store.authenticate(
      new Request("https://nostos.invalid/", {
        headers: { cookie: accountCookie + "=" + values[0]!.value },
      }),
    );
    return merchant
      ? merchant.destination
        ? "/merchant/overview"
        : "/setup"
      : undefined;
  } finally {
    store.close();
  }
}
