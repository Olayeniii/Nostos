import {
  parsePaymentRecord,
  type PaymentRecord,
} from "../../../packages/core/src/index.js";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { decodeMemo } from "../../../packages/memo/src/index.js";
import type { ShieldedNote } from "../../../packages/zcash-adapter/src/index.js";

export interface PaymentNoteSource {
  listUnspent(addresses?: string[]): Promise<ShieldedNote[]>;
}

export interface IntakeResult {
  created: number;
  observed: number;
  payments: PaymentRecord[];
}

function amountZat(note: ShieldedNote): number {
  const zec = note.value ?? note.amount;
  if (typeof zec !== "number" || !Number.isFinite(zec) || zec <= 0) {
    throw new Error("Payment note has no valid positive amount.");
  }
  const zat = Math.round(zec * 100_000_000);
  if (Math.abs(zat / 100_000_000 - zec) > Number.EPSILON) {
    throw new Error("Payment note amount exceeds Zcash precision.");
  }
  return zat;
}

function candidateMemo(note: ShieldedNote): boolean {
  if (note.memoStr?.includes('"p":"nostos"')) return true;
  if (!note.memo) return false;
  try {
    return Buffer.from(note.memo.replace(/(?:00)+$/u, ""), "hex")
      .toString("utf8")
      .includes('"p":"nostos"');
  } catch {
    return false;
  }
}

export async function ingestMerchantPayments(options: {
  merchantId: string;
  source: PaymentNoteSource;
  store: SqlitePaymentStore;
  addresses?: string[];
}): Promise<IntakeResult> {
  const notes = await options.source.listUnspent(options.addresses);
  const payments: PaymentRecord[] = [];
  let created = 0;

  for (const note of notes) {
    if (!note.txid || !candidateMemo(note)) continue;
    const memo = decodeMemo(note);
    const payment = parsePaymentRecord({
      id: note.txid,
      merchantId: options.merchantId,
      orderReference: memo.o,
      paymentTxId: note.txid,
      amountZat: amountZat(note),
      refundAddress: memo.r,
      confirmations: note.confirmations ?? 0,
      status: (note.confirmations ?? 0) > 0 ? "confirmed" : "detected",
    });
    const stored = options.store.insertPayment(payment);
    if (stored.created) created += 1;
    payments.push(stored.payment);
  }

  options.store.recordScannerRun(payments.length, created);
  return { created, observed: payments.length, payments };
}
