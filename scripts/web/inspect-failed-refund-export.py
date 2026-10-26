"""Read one failed transaction from an operator's private ZODL SQLite export.

Diagnostic only. No RPC, keys, raw bytes, addresses, memos, or state changes.
An exported database is operator-supplied evidence, not native expiry proof.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import struct


def inspect(path, txid):
    if not re.fullmatch(r"[a-f0-9]{64}", txid):
        raise ValueError("A full lowercase transaction ID is required.")
    path = Path(path).absolute()
    info, parent = path.lstat(), path.parent.stat()
    if (path.resolve() != path or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid() or info.st_nlink != 1
            or parent.st_uid != os.getuid() or parent.st_mode & 0o077
            or not 100 <= info.st_size <= 256 * 1024 * 1024):
        raise ValueError("Use a regular export in a private operator-owned directory.")
    if Path(str(path) + "-wal").exists():
        raise ValueError("Export has a WAL sidecar. Preserve it for review.")
    with path.open("rb") as source:
        if source.read(16) != b"SQLite format 3\0":
            raise ValueError("Expected the SQLite data export, not a recovery phrase or another file.")
    db = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        table = db.execute("SELECT type FROM sqlite_schema WHERE name='transactions'").fetchone()
        if table != ("table",):
            raise ValueError("Expected a transactions table in the exported wallet database.")
        columns = {row[1] for row in db.execute("PRAGMA table_info(transactions)")}
        if not {"txid", "raw", "expiry_height"}.issubset(columns):
            raise ValueError("Unsupported wallet export schema. No wallet state changed.")
        mined = "mined_height" if "mined_height" in columns else "block" if "block" in columns else None
        if not mined:
            raise ValueError("Export does not expose a recognized mined-height column.")
        value = bytes.fromhex(txid)
        rows = db.execute(
            "SELECT expiry_height," + mined + ",length(raw),substr(raw,1,20) "
            "FROM transactions WHERE txid=? OR txid=? OR txid=? LIMIT 2",
            (value, value[::-1], txid),
        ).fetchall()
        if len(rows) != 1:
            return dict(read_only=True, matching_records=len(rows), retry_authorized=False)
        expiry, height, length, prefix = rows[0]
        result = dict(read_only=True, matching_records=1,
            recorded_expiry_height=expiry if type(expiry) is int else None,
            recorded_mined_height=height if type(height) is int else None,
            raw_transaction_present=type(length) is int and length > 0,
            raw_transaction_bytes=length if type(length) is int else 0,
            retry_authorized=False, native_identity_verified=False)
        if isinstance(prefix, bytes) and len(prefix) == 20:
            header = struct.unpack_from("<I", prefix, 0)[0]
            if header in (0x80000005, 0x80000006):
                encoded = struct.unpack_from("<I", prefix, 16)[0]
                result.update(serialized_version=header & 0x7fffffff,
                    serialized_expiry_height=encoded,
                    expiry_fields_match=type(expiry) is int and encoded == expiry)
        return result
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--txid", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.path, args.txid)))
    except Exception as error:
        print(json.dumps(dict(read_only=True, retry_authorized=False,
            error=str(error) if isinstance(error, ValueError) else "Export inspection failed; preserve the file.")))
        raise SystemExit(1)
