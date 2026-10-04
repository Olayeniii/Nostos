import { AccountHelp } from "../../src/account-help.js";
export default async function Help({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string }>;
}) {
  const { purpose } = await searchParams;
  return <AccountHelp reset={purpose === "reset"} />;
}
