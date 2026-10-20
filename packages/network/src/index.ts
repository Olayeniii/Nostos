export type Network = "testnet" | "mainnet";
export function runtimeNetwork(): Network {
  const value = process.env.NOSTOS_NETWORK ?? "testnet";
  if (value !== "testnet" && value !== "mainnet")
    throw new Error("Invalid network configuration.");
  return value;
}
export function addressOnNetwork(address: string, network: Network) {
  return new RegExp(
    `^${network === "mainnet" ? "u1" : "utest1"}[a-z0-9]{20,500}$`,
    "u",
  ).test(address);
}
export function runtimeValue(name: string): string | undefined {
  return process.env[
    runtimeNetwork() === "mainnet"
      ? name.replace("NOSTOS_", "NOSTOS_MAINNET_")
      : name
  ];
}
export function productConfiguration() {
  const network = runtimeNetwork();
  if (network === "mainnet" && process.env.NOSTOS_MAINNET_ENABLED !== "yes")
    throw new Error("Mainnet is not enabled.");
  const path = runtimeValue("NOSTOS_PRODUCT_DATABASE_PATH");
  const corePath = runtimeValue("NOSTOS_PRODUCT_CORE_DATABASE_PATH");
  const key = runtimeValue("NOSTOS_PRODUCT_DATA_KEY");
  if (network === "mainnet") {
    if (
      !path?.startsWith("/") ||
      !corePath?.startsWith("/") ||
      path === corePath ||
      [path, corePath].some((p) =>
        [
          process.env.NOSTOS_PRODUCT_DATABASE_PATH,
          process.env.NOSTOS_PRODUCT_CORE_DATABASE_PATH,
          process.env.NOSTOS_DATABASE_PATH,
        ].includes(p),
      ) ||
      !key ||
      key === process.env.NOSTOS_PRODUCT_DATA_KEY
    )
      throw new Error("Separate mainnet storage and key are required.");
    const mode = runtimeValue("NOSTOS_WALLET_MODE");
    if (mode && mode !== "observer-preview")
      throw new Error("Invalid mainnet wallet mode.");
    const preview = mode === "observer-preview";
    if (
      preview &&
      (runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE") ||
        runtimeValue("NOSTOS_MERCHANT_WALLET_RPC_URL"))
    )
      throw new Error("Observer preview must not configure a hosted signer.");
    const cookieName = preview
      ? "NOSTOS_OBSERVER_RPC_COOKIE_FILE"
      : "NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE";
    const urlName = preview
      ? "NOSTOS_OBSERVER_RPC_URL"
      : "NOSTOS_MERCHANT_WALLET_RPC_URL";
    const cookie = runtimeValue(cookieName);
    const url = runtimeValue(urlName);
    if (
      !cookie ||
      !url ||
      cookie === process.env[cookieName] ||
      url === process.env[urlName] ||
      cookie === process.env.NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE ||
      url === process.env.NOSTOS_MERCHANT_WALLET_RPC_URL
    )
      throw new Error("Separate mainnet wallet configuration is required.");
  }
  return { network, path, corePath, key };
}
