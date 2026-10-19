import { randomUUID } from "node:crypto";
import type { SqlitePaymentStore } from "../../../packages/database/src/index.js";
import { orchardRefundReceiver } from "../../../packages/zcash-adapter/src/refund-route.js";
import {
  runtimeNetwork,
  addressOnNetwork,
} from "../../../packages/network/src/index.js";
import { ProductStore, type Merchant } from "./product-store.js";
import { assertWalletReady, type WalletRpc } from "./wallet-runtime.js";

export class FundsError extends Error {}
const active = ["broadcasting", "broadcast_unknown", "broadcast"];
type Withdrawal = {
  id: string;
  merchantId: string;
  network: string;
  destination: string;
  amountZat: number;
  feeZat: number;
  status: string;
  txid: string | null;
  expiresAt: number;
  pczt: string;
};
function guard(ok: unknown): asserts ok {
  if (!ok)
    throw new FundsError(
      "Withdrawal checks did not pass. Refresh your funds and recorded status.",
    );
}
function feeBuffer() {
  const n = Number(process.env.NOSTOS_REFUND_FEE_BUFFER_ZAT ?? 10000);
  guard(Number.isSafeInteger(n) && n >= 10000 && n <= 10000000);
  return n;
}
function withdrawals(
  store: ProductStore,
  core: SqlitePaymentStore,
  merchantId: string,
): Withdrawal[] {
  return core
    .withdrawalDatabase()
    .prepare(
      "SELECT * FROM merchant_withdrawals WHERE merchant_id=? ORDER BY created_at DESC",
    )
    .all(merchantId)
    .map((r) => ({
      id: String(r.id),
      merchantId: String(r.merchant_id),
      network: String(r.network),
      destination: store.decrypt(String(r.destination)),
      amountZat: Number(r.amount_zat),
      feeZat: Number(r.fee_zat),
      status: String(r.status),
      txid: r.txid ? String(r.txid) : null,
      expiresAt: Number(r.expires_at),
      pczt: store.decrypt(String(r.pczt)),
    }));
}
function publicWithdrawal(w: Withdrawal) {
  return {
    id: w.id,
    network: w.network,
    destination: w.destination,
    amountZat: w.amountZat,
    feeZat: w.feeZat,
    status: w.status,
    txid: w.txid,
    expiresAt: w.expiresAt,
  };
}
function accounting(
  store: ProductStore,
  core: SqlitePaymentStore,
  m: Merchant,
  balance: number,
) {
  guard(Number.isSafeInteger(balance) && balance >= 0);
  let reserved = 0,
    released = 0,
    feeReserve = 0;
  for (const c of store.requests(m.id)) {
    if (c.status !== "confirmed" || !c.paymentTxid) continue;
    const p = core.findByTxid(c.paymentTxid);
    guard(p && p.merchantId === m.id && p.amountZat === c.amountZat);
    const t = core.refundTotals(c.paymentTxid),
      remaining = c.amountZat - t.refundedZat;
    guard(remaining >= 0);
    const open = store
      .refundRequests(c.id)
      .some((r) => ["requested", "approved"].includes(r.status));
    const expired =
      c.refundExpiresAt !== null && Date.parse(c.refundExpiresAt) <= Date.now();
    // Missing/deleted routes cannot silently release a still-open obligation.
    if (remaining && (!expired || open || t.inProgress)) {
      reserved += remaining;
      feeReserve += feeBuffer();
    } else released += remaining;
  }
  const history = withdrawals(store, core, m.id);
  const spent = history
    .filter((w) => active.includes(w.status) || w.status === "confirmed")
    .reduce((n, w) => n + w.amountZat + w.feeZat, 0);
  const blocked =
    core.merchantRefundInProgress(m.id) ||
    history.some((w) => active.includes(w.status));
  guard([reserved, released, feeReserve, spent].every(Number.isSafeInteger));
  // Cap by released, recorded sales as well as wallet funds. Unindexed payments
  // and external top-ups cannot be mistaken for withdrawable merchant earnings.
  return {
    network: runtimeNetwork(),
    spendableZat: balance,
    reservedForRefundsZat: reserved,
    refundFeeAllowanceZat: feeReserve,
    fundingShortfallZat: Math.max(0, reserved + feeReserve - balance),
    withdrawableBeforeFeeZat: blocked
      ? 0
      : Math.max(
          0,
          Math.min(balance - reserved - feeReserve, released - spent),
        ),
    spendingBlocked: blocked,
    history: history.map(publicWithdrawal),
  };
}
async function validateAccount(
  m: Merchant,
  rpc: WalletRpc,
  node: Pick<WalletRpc, "call">,
) {
  guard(
    m.emailVerifiedAt &&
      m.wallet &&
      m.wallet !== "provisioning" &&
      addressOnNetwork(m.destination, runtimeNetwork()),
  );
  await assertWalletReady(rpc, node);
  const destination = await orchardRefundReceiver(m.destination, rpc);
  guard(addressOnNetwork(destination, runtimeNetwork()));
}
export async function merchantFunds(
  store: ProductStore,
  core: SqlitePaymentStore,
  m: Merchant,
  rpc: WalletRpc,
  node: Pick<WalletRpc, "call">,
) {
  await validateAccount(m, rpc, node);
  // Reconcile only a recorded txid, never infer a send from an amount match.
  for (const w of withdrawals(store, core, m.id)) {
    if (!active.includes(w.status) || !w.txid) continue;
    const tx = await rpc.viewTransaction(w.txid);
    const target = await rpc.decodeUnifiedAddress(w.destination);
    let matches = 0;
    for (const out of tx.outputs)
      if (
        out.outgoing === true &&
        out.valueZat === w.amountZat &&
        ["orchard", "ironwood"].includes(out.pool ?? "") &&
        out.address
      ) {
        const receiver = await rpc.decodeUnifiedAddress(out.address);
        if (receiver.orchard === target.orchard) matches++;
      }
    if (tx.txid === w.txid && tx.confirmations > 0 && matches === 1)
      core
        .withdrawalDatabase()
        .prepare(
          "UPDATE merchant_withdrawals SET status='confirmed',updated_at=? WHERE id=? AND merchant_id=? AND status IN ('broadcast','broadcast_unknown','broadcasting')",
        )
        .run(new Date().toISOString(), w.id, m.id);
  }
  return accounting(
    store,
    core,
    m,
    await rpc.spendableShieldedBalanceZat(m.wallet),
  );
}

type Inspect = {
  wallet_created: boolean;
  privacy_policy: string;
  fee_zat: number;
  expiry_height: number;
  transparent: { inputs: unknown[]; outputs: unknown[] };
  sapling: { spends: number; outputs: unknown[] };
  orchard: { outputs: { value_zat?: number; user_address?: string }[] };
  ironwood: { outputs: { value_zat?: number; user_address?: string }[] };
};
function inspectOk(
  i: Inspect,
  destination: string,
  amount: number,
  height: number,
) {
  guard(
    i.wallet_created === true &&
      i.privacy_policy === "FullPrivacy" &&
      Number.isSafeInteger(i.fee_zat) &&
      i.fee_zat > 0 &&
      i.fee_zat <= 10000000 &&
      Number.isSafeInteger(i.expiry_height) &&
      i.expiry_height > height + 2,
  );
  guard(
    i.transparent?.inputs.length === 0 &&
      i.transparent?.outputs.length === 0 &&
      i.sapling?.spends === 0 &&
      i.sapling?.outputs.length === 0,
  );
  const outputs = [...i.orchard.outputs, ...i.ironwood.outputs];
  guard(
    outputs.filter(
      (o) => o.user_address === destination && o.value_zat === amount,
    ).length === 1,
  );
  guard(
    outputs.every(
      (o) =>
        !o.user_address ||
        (o.user_address === destination && o.value_zat === amount),
    ),
  );
}
export async function quoteWithdrawal(
  store: ProductStore,
  core: SqlitePaymentStore,
  m: Merchant,
  destination: string,
  amount: number,
  rpc: WalletRpc,
  node: Pick<WalletRpc, "call">,
) {
  guard(
    Number.isSafeInteger(amount) &&
      amount > 0 &&
      amount <= 100000000 &&
      addressOnNetwork(destination, runtimeNetwork()),
  );
  await validateAccount(m, rpc, node);
  const canonical = await orchardRefundReceiver(destination, rpc);
  guard(canonical === destination);
  const funds = accounting(
    store,
    core,
    m,
    await rpc.spendableShieldedBalanceZat(m.wallet),
  );
  guard(!funds.spendingBlocked && amount < funds.withdrawableBeforeFeeZat);
  const created = await rpc.call<{ pczt: string; privacy_policy: string }>(
    "pczt_create",
    [
      m.wallet,
      [{ address: destination, amount: amount / 1e8 }],
      1,
      "FullPrivacy",
      "orchard",
    ],
  );
  guard(
    typeof created.pczt === "string" &&
      created.pczt.length > 0 &&
      created.pczt.length <= 2000000 &&
      created.privacy_policy === "FullPrivacy",
  );
  const i = await rpc.call<Inspect>("pczt_inspect", [created.pczt]);
  const height = await assertWalletReady(rpc, node);
  inspectOk(i, destination, amount, height);
  guard(
    amount + i.fee_zat <=
      accounting(
        store,
        core,
        m,
        await rpc.spendableShieldedBalanceZat(m.wallet),
      ).withdrawableBeforeFeeZat,
  );
  const id = randomUUID(),
    now = new Date().toISOString(),
    expires = Date.now() + 120000;
  const db = core.withdrawalDatabase();
  db.prepare(
    "UPDATE merchant_withdrawals SET status='expired',pczt='',updated_at=? WHERE merchant_id=? AND status='review'",
  ).run(now, m.id);
  db.prepare(
    "INSERT INTO merchant_withdrawals(id,merchant_id,network,destination,amount_zat,fee_zat,pczt,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'review',?,?,?)",
  ).run(
    id,
    m.id,
    runtimeNetwork(),
    store.encrypt(destination),
    amount,
    i.fee_zat,
    store.encrypt(created.pczt),
    expires,
    now,
    now,
  );
  return publicWithdrawal(
    withdrawals(store, core, m.id).find((w) => w.id === id)!,
  );
}
export async function confirmWithdrawal(
  store: ProductStore,
  core: SqlitePaymentStore,
  m: Merchant,
  id: string,
  rpc: WalletRpc,
  node: Pick<WalletRpc, "call">,
) {
  const w = withdrawals(store, core, m.id).find((w) => w.id === id);
  guard(w && w.network === runtimeNetwork());
  if (w.status === "broadcast" || w.status === "confirmed")
    return publicWithdrawal(w);
  guard(w.status === "review" && w.expiresAt > Date.now());
  await validateAccount(m, rpc, node);
  const balance = await rpc.spendableShieldedBalanceZat(m.wallet);
  const i = await rpc.call<Inspect>("pczt_inspect", [w.pczt]);
  inspectOk(i, w.destination, w.amountZat, await assertWalletReady(rpc, node));
  guard(i.fee_zat === w.feeZat);
  const db = core.withdrawalDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const funds = accounting(store, core, m, balance);
    guard(
      !funds.spendingBlocked &&
        w.amountZat + w.feeZat <= funds.withdrawableBeforeFeeZat,
    );
    guard(
      db
        .prepare(
          "UPDATE merchant_withdrawals SET status='broadcasting',updated_at=? WHERE id=? AND merchant_id=? AND status='review' AND expires_at>?",
        )
        .run(new Date().toISOString(), id, m.id, Date.now()).changes === 1,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  // From this boundary onward a crash or error is unresolved. No time-based
  // lock release, automatic retry or new instruction is permitted.
  try {
    const proved = await rpc.call<{ pczt: string }>("pczt_prove", [w.pczt]);
    guard(typeof proved.pczt === "string");
    const checked = await rpc.call<Inspect>("pczt_inspect", [proved.pczt]);
    inspectOk(
      checked,
      w.destination,
      w.amountZat,
      await assertWalletReady(rpc, node),
    );
    guard(checked.fee_zat === w.feeZat);
    const signed = await rpc.call<{ pczt: string }>("pczt_sign", [
      proved.pczt,
      "FullPrivacy",
      true,
    ]);
    guard(typeof signed.pczt === "string");
    const extracted = await rpc.call<{
      hex: string;
      txid: string;
      stored: boolean;
    }>("pczt_extract", [signed.pczt]);
    guard(
      extracted.stored === true &&
        /^[a-f0-9]{64}$/.test(extracted.txid) &&
        /^[a-f0-9]+$/.test(extracted.hex),
    );
    // Persist the exact ID before any network broadcast; signed bytes stay in memory.
    db.prepare(
      "UPDATE merchant_withdrawals SET txid=?,pczt='',updated_at=? WHERE id=? AND status='broadcasting'",
    ).run(extracted.txid, new Date().toISOString(), id);
    const sent = await node.call<string>("sendrawtransaction", [extracted.hex]);
    guard(sent === extracted.txid);
    db.prepare(
      "UPDATE merchant_withdrawals SET status='broadcast',updated_at=? WHERE id=? AND status='broadcasting'",
    ).run(new Date().toISOString(), id);
    return publicWithdrawal(
      withdrawals(store, core, m.id).find((v) => v.id === id)!,
    );
  } catch {
    db.prepare(
      "UPDATE merchant_withdrawals SET status='broadcast_unknown',updated_at=? WHERE id=? AND status='broadcasting'",
    ).run(new Date().toISOString(), id);
    throw new FundsError(
      "Withdrawal outcome needs reconciliation. Do not submit another withdrawal or refund.",
    );
  }
}
