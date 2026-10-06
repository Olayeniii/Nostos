export const DEFAULT_REFUND_WINDOW_DAYS = 30;
export function validRefundWindow(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 365
  );
}
