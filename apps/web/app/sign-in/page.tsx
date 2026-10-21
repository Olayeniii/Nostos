import { redirect } from "next/navigation";
import { AccountForm } from "../../src/account-form.js";
import { accountWorkspace } from "../../src/account-workspace.server.js";
export default async function SignIn() {
  const destination = await accountWorkspace();
  if (destination) redirect(destination);
  return <AccountForm />;
}
