// Read-only RPC readiness. Emits no endpoints, cookies, accounts or destinations.
try {
  const { runtimeNetwork, runtimeValue } = await import(
    "/app/.build/packages/network/src/index.js"
  );
  const network = runtimeNetwork();
  const configured = [
    "NOSTOS_CHAIN_RPC_URL",
    "NOSTOS_CHAIN_RPC_COOKIE_FILE",
    "NOSTOS_MERCHANT_WALLET_RPC_URL",
    "NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE",
  ].every((k) => !!runtimeValue(k));
  if (!configured)
    process.stdout.write(
      JSON.stringify({
        read_only: true,
        network,
        rpc_configuration_complete: false,
        sends_requested: 0,
      }) + "\n",
    );
  else {
    const { wallet } = await import(
      "/app/.build/apps/web/src/product-service.js"
    );
    const { chainWallet, assertWalletReady } = await import(
      "/app/.build/apps/web/src/wallet-runtime.js"
    );
    const height = await assertWalletReady(wallet(15000), chainWallet());
    process.stdout.write(
      JSON.stringify({
        read_only: true,
        network,
        rpc_configuration_complete: true,
        wallet_and_node_same_fully_synced_tip: true,
        height,
        sends_requested: 0,
      }) + "\n",
    );
  }
} catch {
  process.stdout.write(
    JSON.stringify({
      read_only: true,
      readiness_verified: false,
      sends_requested: 0,
    }) + "\n",
  );
  process.exitCode = 1;
}
