export type TaskState =
  | "ready"
  | "preparing"
  | "broadcast"
  | "confirmed"
  | "failed"
  | "broadcast_unknown";
export function taskPresentation(state: TaskState) {
  const labels: Record<TaskState, string> = {
    ready: "Ready",
    preparing: "Preparing shielded transaction",
    broadcast: "Sent, waiting for confirmation",
    confirmed: "Confirmed privately",
    failed: "Transaction was not sent",
    broadcast_unknown: "Reconciliation required before retry",
  };
  return {
    label: labels[state],
    animate: state === "preparing" || state === "broadcast",
    canSubmit: state === "ready" || state === "failed",
    retryBlocked: state === "broadcast_unknown" || state === "broadcast",
  };
}
