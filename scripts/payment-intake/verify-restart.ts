import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SqlitePaymentStore } from "../../packages/database/src/index.js";

interface GateG1Evidence {
  payment?: { txid?: string };
}

const root = resolve(process.cwd());
const g1 = JSON.parse(
  await readFile(resolve(root, "scripts/evidence/gate-g1.json"), "utf8"),
) as GateG1Evidence;
const paymentTxid = g1.payment?.txid;
if (!paymentTxid) throw new Error("Gate G1 payment transaction is missing.");

const store = new SqlitePaymentStore(
  resolve(
    process.env.NOSTOS_DATABASE_PATH?.trim() || "./runtime/nostos.sqlite",
  ),
);

try {
  const payment = store.findByTxid(paymentTxid);
  const summary = store.scannerRunSummary();
  if (!payment) throw new Error("The Gate G1 payment was not stored.");
  if (store.paymentCount() !== 1) {
    throw new Error("Payment intake contains duplicate or unexpected records.");
  }
  if (summary.runs < 2 || summary.observedPayments < 2) {
    throw new Error("Run the scanner in at least two separate processes.");
  }
  if (summary.createdPayments !== 1) {
    throw new Error("The payment was not created exactly once.");
  }

  const evidence = {
    classification: "real",
    network: "testnet",
    verifiedAt: new Date().toISOString(),
    paymentTxid,
    orderReference: payment.orderReference,
    processRuns: summary.runs,
    paymentObservations: summary.observedPayments,
    recordsCreated: summary.createdPayments,
    storedPayments: store.paymentCount(),
    duplicateRecords: 0,
    checks: {
      realPaymentStored: true,
      separateScannerRuns: true,
      restartSafe: true,
      uniqueTransactionConstraint: true,
    },
  };
  const path = resolve(root, "scripts/evidence/gate-g3.json");
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log("Gate G3 passed: payment intake remained unique after restart.");
  console.log(`Payment: ${paymentTxid}`);
  console.log(`Scanner processes: ${summary.runs}`);
  console.log(`Stored records: ${store.paymentCount()}`);
  console.log("Evidence: scripts/evidence/gate-g3.json");
} finally {
  store.close();
}
