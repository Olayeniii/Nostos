#!/usr/bin/env python3
"""Opt-in offline SDK observer backup. Never stops a service or overwrites a wallet."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import selectors
import time
import stat
import subprocess
import sys

LIMIT = 256 * 1024 * 1024
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z")
FILES = {"wallet.sqlite", "wallet.sqlite-wal", "wallet.sqlite-shm", "wallet.sqlite-journal", "writer.lock"}


def require(ok):
    if not ok:
        raise ValueError("backup_check_failed")


def directory(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path)
    meta = path.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == os.getuid() and not meta.st_mode & 0o077)
    for parent in path.parents:
        m = parent.lstat()
        require(stat.S_ISDIR(m.st_mode) and m.st_uid in (0, os.getuid()))
        require(not m.st_mode & 0o022 or (m.st_uid == 0 and m.st_mode & stat.S_ISVTX))
    return path


def private_file(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path)
    m = path.lstat()
    require(stat.S_ISREG(m.st_mode) and m.st_uid == os.getuid() and not m.st_mode & 0o077 and m.st_nlink == 1)
    directory(path.parent)
    return path


def audit(root):
    directory(root)
    require({p.name for p in root.iterdir()} <= FILES)
    for p in root.iterdir():
        private_file(p)
    require((root / "wallet.sqlite").exists())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def open_private(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    return os.fdopen(fd, "w+b")


def validate_db(db):
    require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)])
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    require({"accounts", "transactions"} <= tables)


def snapshot(root):
    root = directory(root)
    audit(root)
    lockpath = root / "writer.lock"
    fd = os.open(lockpath, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+b") as lock:
        private_file(lockpath)
        # Same Linux flock primitive used by Rust File.try_lock(). Never wait or kill.
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        audit(root)
        require(sum(p.stat().st_size for p in root.iterdir()) <= LIMIT)
        source = sqlite3.connect((root / "wallet.sqlite").as_uri() + "?mode=ro", uri=True, timeout=1)
        memory = sqlite3.connect(":memory:")
        try:
            source.backup(memory, pages=256, sleep=0.01)
            validate_db(memory)
            data = bytearray(memory.serialize())
            require(len(data) <= LIMIT and data.startswith(b"SQLite format 3\x00"))
            # Only the detached backup image changes. SQLite documents this WAL
            # deserialize fix: https://sqlite.org/c3ref/deserialize.html
            data[18] = data[19] = 1
            audit(root)
            return bytes(data)
        finally:
            memory.close()
            source.close()


def backup(root, destination, recipient, merchant):
    root = directory(root)
    require(UUID.fullmatch(merchant) and root.name == merchant)
    require(re.fullmatch(r"age1[0-9a-z]{58}", recipient))
    destination = Path(destination)
    directory(destination.parent)
    require(destination.is_absolute() and destination.parent != root)
    data = snapshot(root)
    manifest = dict(format="nostos-sdk-observer-v1", network="mainnet", merchant=merchant,
                    sha256=hashlib.sha256(data).hexdigest())
    payload = json.dumps(manifest, separators=(",", ":")).encode() + b"\n" + data
    created = False
    try:
        with open_private(destination) as out:
            created = True
            result = subprocess.run(["age", "--encrypt", "--recipient", recipient], input=payload,
                                    stdout=out, stderr=subprocess.DEVNULL, timeout=120, check=False)
            require(result.returncode == 0)
            out.flush()
            os.fsync(out.fileno())
        private_file(destination)
        sync_directory(destination.parent)
    except BaseException:
        if created:
            destination.unlink(missing_ok=True)
        raise


def restore(archive, destination, identity, merchant):
    archive = private_file(archive)
    identity = private_file(identity)
    destination = Path(destination)
    directory(destination.parent)
    require(UUID.fullmatch(merchant) and destination.name == merchant and not destination.exists())
    require(archive.stat().st_size <= LIMIT + LIMIT // 10 + 8192)
    require(identity.stat().st_size <= 4096)
    # This tool accepts an offline raw age identity; never trigger a tty prompt.
    require(any(re.fullmatch(r"AGE-SECRET-KEY-1[0-9A-Z]{58}", line)
                for line in identity.read_text().splitlines()))
    # Plaintext stays in bounded memory until validated; errors are never echoed.
    with archive.open("rb") as encrypted:
        with subprocess.Popen(["age", "--decrypt", "--identity", str(identity)], stdin=encrypted,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
            chunks = bytearray()
            deadline = time.monotonic() + 120
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    while True:
                        remaining = deadline - time.monotonic()
                        require(remaining > 0 and selector.select(remaining))
                        chunk = os.read(process.stdout.fileno(), 65536)
                        if not chunk:
                            break
                        chunks.extend(chunk)
                        require(len(chunks) <= LIMIT + 4096)
                require(process.wait(timeout=max(0.01, deadline-time.monotonic())) == 0)
                payload = bytes(chunks)
            except BaseException:
                process.kill()
                process.wait()
                raise
    header, data = payload.split(b"\n", 1)
    require(len(header) <= 4096 and len(data) <= LIMIT)
    manifest = json.loads(header)
    require(manifest == dict(format="nostos-sdk-observer-v1", network="mainnet", merchant=merchant,
                             sha256=hashlib.sha256(data).hexdigest()))
    require(data.startswith(b"SQLite format 3\x00"))
    memory = sqlite3.connect(":memory:")
    created = False
    try:
        memory.deserialize(data)
        validate_db(memory)
        # mkdir refuses existing destinations and symlinks. Never use replace().
        destination.mkdir(mode=0o700)
        created = True
        with open_private(destination / "wallet.sqlite"):
            pass
        target = sqlite3.connect(destination / "wallet.sqlite")
        try:
            memory.backup(target)
            validate_db(target)
        finally:
            target.close()
        audit(destination)
        fd = os.open(destination / "wallet.sqlite", os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        sync_directory(destination)
        sync_directory(destination.parent)
    except BaseException:
        if created:
            for name in FILES:
                (destination / name).unlink(missing_ok=True)
            destination.rmdir()
        raise
    finally:
        memory.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    save = commands.add_parser("backup")
    save.add_argument("--root", required=True)
    save.add_argument("--destination", required=True)
    save.add_argument("--recipient", required=True)
    save.add_argument("--merchant", required=True)
    recover = commands.add_parser("restore")
    recover.add_argument("--archive", required=True)
    recover.add_argument("--destination", required=True)
    recover.add_argument("--identity", required=True)
    recover.add_argument("--merchant", required=True)
    args = vars(parser.parse_args())
    command = args.pop("command")
    try:
        (backup if command == "backup" else restore)(**args)
    except Exception:
        print(json.dumps(dict(passed=False, operation=command, reason="Private backup checks failed; no existing wallet was replaced.", sends_requested=0)))
        return 1
    print(json.dumps(dict(passed=True, operation=command, existing_wallet_replaced=False, sends_requested=0)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
