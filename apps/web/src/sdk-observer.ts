import {
  ZalletRpcClient,
  type ZalletRpcConfig,
} from "../../../packages/zcash-adapter/src/index.js";

// This transport cannot be used as a signer, including through inherited helpers.
export class SdkObserverClient extends ZalletRpcClient {
  readonly #merchant: string;
  constructor(config: ZalletRpcConfig, merchant: string) {
    super(config);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        merchant,
      )
    )
      throw new Error("SDK observer merchant is invalid.");
    this.#merchant = merchant;
  }
  override async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (
      ![
        "getwalletstatus",
        "z_importviewingkey",
        "z_listunifiedreceivers",
        "nostos_verify_output",
      ].includes(method)
    )
      throw new Error("SDK observer operation is unavailable.");
    const value = await super.call<T>(method, [this.#merchant, ...params]);
    if (method !== "z_listunifiedreceivers") {
      const result = value as Record<string, unknown> | null;
      if (
        !result ||
        (method === "nostos_verify_output"
          ? result.nostos_output_proof_v1 !== true ||
            result.payments_enabled !== false
          : result.nostos_sdk_preview_v1 !== true) ||
        result.observation_scope !== "orchard-family-only" ||
        (method === "getwalletstatus" && result.payments_enabled !== false)
      )
        throw new Error("SDK observer response could not be verified.");
    }
    return value;
  }
}
