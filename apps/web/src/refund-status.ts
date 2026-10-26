export type RefundCheckCode =
  | "awaiting_wallet"
  | "awaiting_detection"
  | "confirming"
  | "observer_syncing"
  | "observer_unavailable"
  | "transaction_unseen"
  | "output_unverified"
  | "checking";

export const refundCheckMessages: Record<RefundCheckCode, string> = {
  awaiting_wallet: "Waiting for wallet approval. No refund has been verified.",
  awaiting_detection:
    "Waiting to detect the refund. Check your wallet history before any further action.",
  confirming: "Refund transaction found. Waiting for three confirmations.",
  observer_syncing:
    "The observer is catching up. Your refund reservation is preserved and checks will continue.",
  observer_unavailable:
    "The verification service is unavailable. Your refund reservation is preserved. Check again when the connection returns.",
  transaction_unseen:
    "The transaction is not available from the chain lookup yet. Check wallet history and keep the saved reference. Do not send again.",
  output_unverified:
    "The transaction is confirmed, but its output has not passed the saved refund checks. Keep the transaction reference for recovery. Do not send again.",
  checking:
    "A refund check is already running. Saved records will refresh when it finishes.",
};
export function isRefundCheckCode(value: unknown): value is RefundCheckCode {
  return typeof value === "string" && Object.hasOwn(refundCheckMessages, value);
}
export function refundStageLabel(stage: RefundCheckCode) {
  switch (stage) {
    case "awaiting_wallet":
      return "Awaiting wallet approval";
    case "awaiting_detection":
      return "Awaiting refund detection";
    case "confirming":
      return "Awaiting confirmations";
    case "observer_syncing":
      return "Observer catching up";
    case "observer_unavailable":
      return "Verification unavailable";
    case "transaction_unseen":
      return "Checking wallet submission";
    case "output_unverified":
      return "Refund verification needs attention";
    case "checking":
      return "Checking refund";
  }
}
