"""Private import/reopen check for an explicitly never-funded business account."""
import argparse
import contextlib
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import sqlite3
import stat
import subprocess
import sys
import uuid
import warnings


def require(condition):
    if not condition:
        raise ValueError("private_import_unresolved")


def private_directory(path):
    require(path.is_absolute() and path.resolve() == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077)
    for parent in path.parents:
        info = parent.lstat()
        require(info.st_uid in (0, os.getuid()))
        require(not info.st_mode & 0o022 or info.st_uid == 0 and info.st_mode & stat.S_ISVTX)


def private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_nlink == 1)


def status_valid(value):
    require(value.get("nostos_sdk_preview_v1") is True and value.get("payments_enabled") is False)
    require(value.get("observation_scope") == "orchard-family-only")
    require(type(value.get("account_connected")) is bool and type(value.get("locked")) is bool)
    height = value.get("node_tip", {}).get("height")
    require(type(height) is int and 100 < height <= 0xffffffff)
    return height


def call(binary, wallet, method, params):
    require(method in ("getwalletstatus", "z_importviewingkey", "nostos_sync"))
    request = json.dumps(dict(id=1, method=method, params=params)) + "\n"
    require(len(request.encode()) <= 16384)
    process = subprocess.Popen([str(binary), str(wallet)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env={"PATH": "/usr/bin:/bin"})
    try:
        output, _ = process.communicate(request.encode(), timeout=1800 if method == "nostos_sync" else 120)
    except subprocess.TimeoutExpired:
        # Never kill an in-progress database write or start another worker here.
        # Its durable wallet and exclusive lock remain the recovery boundary.
        raise ValueError("private_import_unresolved") from None
    require(process.returncode == 0 and len(output) <= 16384)
    response = json.loads(output)
    require(type(response.get("id")) is int and response["id"] == 1 and "error" not in response)
    require(isinstance(response.get("result"), dict))
    return response["result"]


def reconcile(db, wallet_parent, binary, digest, hidden_key):
    row = db.execute("SELECT merchant,birthday,account,binary_hash FROM plan WHERE id=1").fetchone()
    if row is None:
        merchant = str(uuid.uuid4())
        with db:
            db.execute("INSERT INTO plan VALUES(1,?,NULL,NULL,?)", (merchant, digest))
        row = (merchant, None, None, digest)
    merchant, birthday, account, saved_digest = row
    require(str(uuid.UUID(merchant)) == merchant and saved_digest == digest)
    wallet = wallet_parent / merchant
    wallet.mkdir(mode=0o700, exist_ok=True)
    private_directory(wallet)
    status = call(binary, wallet, "getwalletstatus", [])
    tip = status_valid(status)
    if birthday is None:
        require(status["account_connected"] is False)
        birthday = tip - 100
        with db:
            db.execute("UPDATE plan SET birthday=? WHERE id=1", (birthday,))
    require(type(birthday) is int and 0 < birthday <= tip)
    if account is None:
        key = hidden_key()
        require(isinstance(key, str) and key.startswith("uview1") and len(key) <= 3000)
        imported = call(binary, wallet, "z_importviewingkey", [key, "whenkeyisnew", birthday])
        del key
        require(imported.get("nostos_view_only_v1") is True and imported.get("nostos_sdk_preview_v1") is True)
        require(imported.get("observation_scope") == "orchard-family-only")
        account = imported.get("account_uuid")
        require(isinstance(account, str) and str(uuid.UUID(account)) == account)
        with db:
            db.execute("UPDATE plan SET account=? WHERE id=1", (account,))
    require(str(uuid.UUID(account)) == account)
    synced = call(binary, wallet, "nostos_sync", [])
    status_valid(synced)
    require(synced["account_connected"] is True)
    # Every call starts and normally closes its worker. This checks another open.
    reopened = call(binary, wallet, "getwalletstatus", [])
    status_valid(reopened)
    require(reopened["account_connected"] is True)
    return dict(private_import_checked=True, account_connected=True,
                sync_ready=not synced["locked"] and not reopened["locked"],
                reopened=True, payments_enabled=False, sends_requested=0)


@contextlib.contextmanager
def ledger(root):
    root.mkdir(mode=0o700, exist_ok=True)
    private_directory(root)
    require(all(p.name in ("plan.sqlite", "plan.sqlite-journal", "import.lock") for p in root.iterdir()))
    lock = os.open(root / "import.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    db = None
    try:
        private_file(root / "import.lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd = os.open(root / "plan.sqlite", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        private_file(root / "plan.sqlite")
        db = sqlite3.connect(root / "plan.sqlite", timeout=0)
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS plan(id INTEGER PRIMARY KEY CHECK(id=1), merchant TEXT NOT NULL,birthday INTEGER,account TEXT,binary_hash TEXT NOT NULL)")
        db.commit()
        yield db
    finally:
        if db is not None:
            db.close()
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("installation", type=Path)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--never-funded", action="store_true", required=True)
    args = parser.parse_args()
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.umask(0o077)
        require(sys.stdin.isatty() and sys.stdout.isatty() and sys.stderr.isatty())
        warnings.simplefilter("error", getpass.GetPassWarning)
        base = args.installation
        private_directory(base)
        private_directory(base / "state")
        binary = base / "nostos-sdk-worker"
        private_file(binary)
        require(os.access(binary, os.X_OK) and re.fullmatch(r"[a-f0-9]{64}", args.binary_sha256))
        require(hashlib.sha256(binary.read_bytes()).hexdigest() == args.binary_sha256)
        with ledger(base / "private-import") as db:
            report = reconcile(db, base / "state", binary, args.binary_sha256,
                               lambda: getpass.getpass("Full viewing key from the never-funded business account (hidden): "))
        print(json.dumps(report))
        return 0
    except (Exception, KeyboardInterrupt):
        print(json.dumps(dict(private_import_unresolved=True, payments_enabled=False, sends_requested=0)))
        return 1


if __name__ == "__main__":
    sys.exit(main())
