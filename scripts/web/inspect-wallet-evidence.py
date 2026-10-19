"""Read-only merchant wallet metadata, with no RPC, signing or raw data output."""

import json
from pathlib import Path
import re
import sqlite3
import stat
import subprocess


KNOWN = {
    "payment": "6f692f8c99d355f9a1d3ddf99a76df1cdaf3f81bbc07a14db7d460c838f9c91e",
    "confirmed_refund": "ad7ff94e16ba2793d2831166d9dcfe6ebaf045856db2aa56808db55134965272",
}


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def txid(value):
    if isinstance(value, bytes) and len(value) == 32:
        return value.hex()
    if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9]{64}", value):
        return value.lower()
    return None


def inspect_database(path):
    # mode=ro plus query_only; never use the application's migrating constructor.
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        columns = {r[1] for r in db.execute("PRAGMA table_info(transactions)")}
        if "txid" not in columns:
            return {"transaction_metadata_available": False}
        selected = [c for c in ("txid", "mined_height", "block", "expiry_height") if c in columns]
        # Never select raw transactions, memos, destinations, keys or account names.
        cursor = db.execute("SELECT " + ",".join(map(identifier, selected)) + " FROM transactions")
        found = {name: 0 for name in KNOWN}
        total = other = invalid = unmined = 0
        min_expiry = max_expiry = None
        height_column = "mined_height" if "mined_height" in columns else "block" if "block" in columns else None
        for row in cursor:
            values = dict(zip(selected, row))
            value = txid(values["txid"])
            total += 1
            if value is None:
                invalid += 1
                continue
            # librustzcash stores transaction bytes; compare both display orders.
            reverse = bytes.fromhex(value)[::-1].hex()
            matched = False
            for name, known in KNOWN.items():
                if known in (value, reverse):
                    found[name] += 1
                    matched = True
            if not matched:
                other += 1
                if height_column and values[height_column] is None:
                    unmined += 1
                expiry = values.get("expiry_height")
                if isinstance(expiry, int) and expiry > 0:
                    min_expiry = expiry if min_expiry is None else min(min_expiry, expiry)
                    max_expiry = expiry if max_expiry is None else max(max_expiry, expiry)
        raw_count = None
        if "raw" in columns:
            raw_count = db.execute("SELECT COUNT(*) FROM transactions WHERE raw IS NOT NULL").fetchone()[0]
        return {
            "transaction_metadata_available": True,
            "transaction_count": total, "known_transaction_matches": found,
            "other_transaction_count": other, "invalid_txid_count": invalid,
            "other_unmined_count": unmined if height_column else None,
            "other_expiry_height_min": min_expiry, "other_expiry_height_max": max_expiry,
            "raw_transaction_record_count": raw_count,
            "scope": "All accounts in this running wallet DB; other records are not automatically this refund. No txids, raw transactions, memos, destinations or account details are emitted. Absence is not proof of non-broadcast or complete wallet sync.",
        }
    finally:
        db.close()


def wallet_files(pid):
    files = set()
    for fd in Path("/proc", str(pid), "fd").iterdir():
        try:
            target = fd.resolve(strict=True)
            if target.suffix.lower() not in (".sqlite", ".sqlite3", ".db"):
                continue
            if not target.is_file():
                continue
            with target.open("rb") as stream:
                if stream.read(16) == b"SQLite format 3\0":
                    files.add(target)
        except (OSError, RuntimeError):
            continue
    return sorted(files)


def inspect_running_wallet():
    result = subprocess.run(
        ["systemctl", "show", "nostos-wallet@merchant", "--property=MainPID", "--value"],
        check=True, capture_output=True, text=True, timeout=5,
    )
    value = result.stdout.strip()
    if not value.isdigit() or int(value) < 2:
        raise ValueError("wallet process unavailable")
    pid = int(value)
    exe = Path("/proc", str(pid), "exe").resolve(strict=True)
    version = subprocess.run([str(exe), "--version"], capture_output=True, timeout=5)
    # Numeric release only. Never echo arbitrary process or subprocess output.
    match = re.search(rb"\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?\b", version.stdout[:4096])
    paths = wallet_files(pid)
    reports = []
    for path in paths:
        flags = {}
        for label, file in (("database", path), ("wal", Path(str(path) + "-wal")), ("shm", Path(str(path) + "-shm"))):
            try:
                mode = stat.S_IMODE(file.stat().st_mode)
                flags[label] = {"present": True, "group_or_other_permissions": bool(mode & 0o077)}
            except FileNotFoundError:
                flags[label] = {"present": False}
        try:
            metadata = inspect_database(path)
        except (sqlite3.Error, OSError):
            metadata = {"transaction_metadata_available": False, "inspection_failed": True}
        reports.append({"file_permissions": flags, **metadata})
    return {"read_only": True, "wallet_version": match.group().decode("ascii") if match else None,
            "running_wallet_database_count": len(paths), "databases": reports,
            "refund_resolution": "unresolved_pending_independent_evidence",
            "safe_to_retry": False,
            "scope": "Running merchant service open SQLite files only. No RPC, sends, database migrations, checkpoints, backup copies, log dumps, service restarts or state changes. SQLite reader coordination can touch SHM read marks. Does not prove log, backup, full WAL contents or sync hygiene. Databases not held open by MainPID are not covered."}


if __name__ == "__main__":
    try:
        print(json.dumps(inspect_running_wallet()))
    except (OSError, ValueError, subprocess.SubprocessError):
        print(json.dumps({"read_only": True, "inspection_failed": True, "safe_to_retry": False}))
        raise SystemExit(1)
