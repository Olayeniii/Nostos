import { redirect } from "next/navigation";
import { AccountForm } from "../../src/account-form.js";
import { accountWorkspace } from "../../src/account-workspace.server.js";
export default async function SignUp() {
  const destination = await accountWorkspace();
  if (destination) redirect(destination);
  return <AccountForm signup />;
}
