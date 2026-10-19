"""Gather fresh private metadata in memory and run dry/apply reconciliation."""
import argparse
import datetime
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def run(apply=False):
    spec = importlib.util.spec_from_file_location("wallet_evidence", Path(__file__).with_name("inspect-wallet-evidence.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    meta = module.inspect_running_wallet()
    if meta["wallet_version"] != "0.1.0-beta.3" or meta["running_wallet_database_count"] != 1:
        raise ValueError()
    pid = int(subprocess.check_output(["systemctl", "show", "nostos-wallet@merchant", "--property=MainPID", "--value"], text=True, timeout=5))
    paths = module.wallet_files(pid)
    if len(paths) != 1:
        raise ValueError()
    db = sqlite3.connect(paths[0].as_uri() + "?mode=ro", uri=True, timeout=2)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        # Read account metadata and the block anchor from this same snapshot.
        known_rows = {name: [bytes.fromhex(value)[::-1]] for name, value in module.KNOWN.items()}
        matching = module.account_evidence(db, known_rows)
        scopes = []
        for name, positive in (("payment", True), ("confirmed_refund", False)):
            raw = bytes.fromhex(module.KNOWN[name])[::-1]
            scopes.append({a for a, delta in db.execute("SELECT account_uuid,account_balance_delta FROM v_transactions WHERE txid=?", (raw,)) if isinstance(a, bytes) and len(a) == 16 and ((positive and delta > 0) or (not positive and delta < 0))})
        common = scopes[0] & scopes[1]
        if len(common) != 1:
            raise ValueError()
        cutoff = int(datetime.datetime(2026, 10, 12, 15, 39, 26, tzinfo=datetime.timezone.utc).timestamp())
        anchor = db.execute("SELECT height,time FROM blocks WHERE time>=? ORDER BY height LIMIT 1", (cutoff,)).fetchone()
        tip = db.execute("SELECT MAX(height) FROM blocks").fetchone()[0]
        if not anchor:
            raise ValueError()
        proof = {"walletVersion": meta["wallet_version"], "observedAt": int(time.time() * 1000),
                 "matchingAccount": matching, "accountUuid": str(uuid.UUID(bytes=next(iter(common)))),
                 "expiryAnchor": {"height": anchor[0], "time": anchor[1]}, "latestStoredBlock": tip}
    finally:
        db.close()
    # Deployment must carry the failed-state semantics. Never invoke an older app.
    revision = subprocess.check_output(["git", "-c", "safe.directory=" + str(ROOT), "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.PIPE, timeout=5).strip()
    mounted = subprocess.check_output(["docker", "inspect", "--format", '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}', "nostos-web"], text=True, timeout=5).strip()
    if not Path(mounted).name.startswith(revision[:12] + "-"):
        return {"reconciliation_blocked": True, "reason": "checkout_revision_not_live", "sends_requested": 0}
    command = ["docker", "exec", "-i", "nostos-web", "node", "/app/scripts/web/reconcile-item21.mjs"]
    if apply:
        command.append("--apply")
    result = subprocess.run(command, input=json.dumps(proof), capture_output=True, text=True, timeout=55)
    # Only sanitized JSON from the narrow recovery tool is emitted, never stderr.
    output = json.loads(result.stdout)
    if not isinstance(output, dict) or not ("eligible" in output or "reconciliation_blocked" in output):
        raise ValueError()
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Reconcile only; never send funds")
    args = parser.parse_args()
    try:
        output = run(args.apply)
        print(json.dumps(output))
        if output.get("reconciliation_blocked"):
            raise SystemExit(1)
    except (OSError, ValueError, KeyError, sqlite3.Error, subprocess.SubprocessError):
        print(json.dumps({"reconciliation_blocked": True, "state_changed": None if args.apply else False, "sends_requested": 0}))
        raise SystemExit(1)
