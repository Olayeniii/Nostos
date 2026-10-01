export const paymentStatuses = [
  "detected",
  "confirmed",
  "refund_pending",
  "refund_broadcast",
  "broadcast_unknown",
  "refunded",
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export interface PaymentRecord {
  id: string;
  merchantId: string;
  orderReference: string;
  paymentTxId: string;
  amountZat: number;
  refundAddress: string;
  confirmations: number;
  status: PaymentStatus;
}

export interface RefundIntent {
  id: string;
  paymentId: string;
  idempotencyKey: string;
  amountZat: number;
}

export const refundStatuses = [
  "pending",
  "broadcasting",
  "broadcast_unknown",
  "broadcast",
  "confirmed",
] as const;

export type RefundStatus = (typeof refundStatuses)[number];

export interface RefundRecord extends RefundIntent {
  status: RefundStatus;
  txid?: string;
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)
  ) {
    throw new DomainValidationError(
      `${label} must use 1 to 64 safe characters.`,
    );
  }
  return value;
}

function txid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new DomainValidationError(`${label} must be a 64 character txid.`);
  }
  return value;
}

function zatoshi(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError(
      `${label} must be a positive safe integer in zatoshi.`,
    );
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(
      `${label} must be a non-negative safe integer.`,
    );
  }
  return value;
}

function refundAddress(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:utest1|u1)[a-z0-9]{20,}$/u.test(value)
  ) {
    throw new DomainValidationError(
      "refundAddress must be a Zcash unified address.",
    );
  }
  return value;
}

function paymentStatus(value: unknown): PaymentStatus {
  if (
    typeof value !== "string" ||
    !paymentStatuses.includes(value as PaymentStatus)
  ) {
    throw new DomainValidationError("status is not a supported payment state.");
  }
  return value as PaymentStatus;
}

export function parsePaymentRecord(value: unknown): PaymentRecord {
  const input = record(value, "payment");
  return {
    id: identifier(input.id, "id"),
    merchantId: identifier(input.merchantId, "merchantId"),
    orderReference: identifier(input.orderReference, "orderReference"),
    paymentTxId: txid(input.paymentTxId, "paymentTxId"),
    amountZat: zatoshi(input.amountZat, "amountZat"),
    refundAddress: refundAddress(input.refundAddress),
    confirmations: nonNegativeInteger(input.confirmations, "confirmations"),
    status: paymentStatus(input.status),
  };
}

export function parseRefundIntent(
  value: unknown,
  payment: PaymentRecord,
): RefundIntent {
  const input = record(value, "refund intent");
  const intent: RefundIntent = {
    id: identifier(input.id, "id"),
    paymentId: identifier(input.paymentId, "paymentId"),
    idempotencyKey: identifier(input.idempotencyKey, "idempotencyKey"),
    amountZat: zatoshi(input.amountZat, "amountZat"),
  };

  if (intent.paymentId !== payment.id) {
    throw new DomainValidationError("Refund paymentId does not match payment.");
  }
  if (intent.amountZat > payment.amountZat) {
    throw new DomainValidationError("Refund cannot exceed the payment amount.");
  }
  if (payment.status !== "confirmed" && payment.status !== "refund_pending") {
    throw new DomainValidationError(
      "Payment is not eligible for a refund instruction.",
    );
  }
  return intent;
}

const transitions: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  detected: ["confirmed"],
  confirmed: ["refund_pending"],
  refund_pending: ["refund_broadcast", "broadcast_unknown"],
  broadcast_unknown: ["refund_broadcast"],
  refund_broadcast: ["refunded"],
  refunded: [],
};

export function transitionPayment(
  payment: PaymentRecord,
  nextStatus: PaymentStatus,
): PaymentRecord {
  if (!transitions[payment.status].includes(nextStatus)) {
    throw new DomainValidationError(
      `Cannot transition payment from ${payment.status} to ${nextStatus}.`,
    );
  }
  return { ...payment, status: nextStatus };
}

export class RefundIdempotencyRegistry {
  readonly #byPayment = new Map<string, RefundIntent>();
  readonly #byKey = new Map<string, RefundIntent>();

  register(intent: RefundIntent): { created: boolean; intent: RefundIntent } {
    const keyed = this.#byKey.get(intent.idempotencyKey);
    if (keyed) {
      if (
        keyed.paymentId !== intent.paymentId ||
        keyed.amountZat !== intent.amountZat
      ) {
        throw new DomainValidationError(
          "Idempotency key was already used for another refund instruction.",
        );
      }
      return { created: false, intent: keyed };
    }

    const existing = this.#byPayment.get(intent.paymentId);
    if (existing) {
      throw new DomainValidationError(
        "A refund instruction already exists for this payment.",
      );
    }

    this.#byPayment.set(intent.paymentId, intent);
    this.#byKey.set(intent.idempotencyKey, intent);
    return { created: true, intent };
  }
}
