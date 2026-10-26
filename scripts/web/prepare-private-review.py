"""Prepare private loopback review settings. Never starts or changes a service."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import stat
import subprocess
import urllib.request

REVISION = "e42d718ea53a0b270d9948b2b90ac6498685e42a"
STAGE = "prerequisites"
BINARY_HASH = "4aeb0a96ba9c00c01a1a9d4b5a144de904eae833ff4e455b665650077b063d74"


def require(value):
    if not value:
        raise ValueError("Private review preparation failed.")


def private_directory(path, uid):
    require(path.is_absolute() and path.resolve() == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o077)


def protected_file(path, uid):
    require(path.is_absolute() and path.resolve() == path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid in (0, uid) and not info.st_mode & 0o077 and info.st_nlink == 1)
    require(info.st_size <= 16384)
    return path


def protected(path, uid):
    return protected_file(path, uid).read_text().strip()


def settings(mail):
    require(set(mail) == {"NOSTOS_EMAIL_API_KEY", "NOSTOS_EMAIL_FROM"})
    require(all(isinstance(mail.get(k), str) and mail[k] for k in ("NOSTOS_EMAIL_API_KEY", "NOSTOS_EMAIL_FROM")))
    require(all(not any(c in v for c in ("\n", "\r", "\0")) for v in mail.values()))
    return dict(
        NOSTOS_NETWORK="mainnet", NOSTOS_MAINNET_ENABLED="yes",
        NOSTOS_MAINNET_WALLET_MODE="observer-preview", NOSTOS_MAINNET_OBSERVER_BACKEND="sdk-preview",
        NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS="yes",
        NOSTOS_MAINNET_PRODUCT_DATABASE_PATH="/preview/product.sqlite",
        NOSTOS_MAINNET_PRODUCT_CORE_DATABASE_PATH="/preview/core.sqlite",
        NOSTOS_MAINNET_PRODUCT_DATA_KEY=secrets.token_hex(32),
        NOSTOS_MAINNET_OBSERVER_RPC_URL="http://127.0.0.1:38235",
        NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE="/preview-rpc/service.cookie",
        NOSTOS_MAINNET_CHAIN_RPC_URL="http://127.0.0.1:38231",
        NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE="/preview-rpc/node.cookie",
        NOSTOS_WEB_TRUSTED_ORIGINS="http://localhost:3108",
        NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN="http://localhost:3108",
        NEXT_TELEMETRY_DISABLED="1", NODE_OPTIONS="--max-old-space-size=1024", **mail)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Private review preparation failed.")


def verify_chain(cookie):
    require(re.fullmatch(r"[^:\s]+:[^\s]+", cookie))
    auth = base64.b64encode(cookie.encode()).decode()
    request = urllib.request.Request("http://127.0.0.1:38231/", method="POST",
        data=json.dumps(dict(jsonrpc="2.0", id=1, method="getblockchaininfo", params=[])).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=15) as response:
        raw = response.read(1000001)
    require(len(raw) <= 1000000)
    payload = json.loads(raw)
    value = payload.get("result", {})
    require(not payload.get("error") and value.get("chain") == "main" and type(value.get("blocks")) is int and value["blocks"] > 0)
    require(re.fullmatch(r"[a-fA-F0-9]{64}", value.get("bestblockhash", "")))


def create_private(path, value, uid, gid):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        os.fchown(stream.fileno(), uid, gid)
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def prepare(review, installation, uid, gid):
    global STAGE
    STAGE = "review_files"
    require(os.geteuid() == 0 and uid > 0 and gid > 0)
    private_directory(review, uid)
    private_directory(installation, uid)
    private_directory(installation / "state", uid)
    revision_file = review / "revision.txt"
    info = revision_file.lstat()
    require(revision_file.resolve() == revision_file and stat.S_ISREG(info.st_mode) and
            info.st_uid == uid and not info.st_mode & 0o022 and info.st_nlink == 1 and info.st_size <= 100)
    require(revision_file.read_text().strip() == REVISION)
    require((review / "source/apps/web/.next/BUILD_ID").is_file())
    binary = installation / "nostos-sdk-worker"
    import hashlib
    require(binary.is_file() and not binary.is_symlink() and hashlib.sha256(binary.read_bytes()).hexdigest() == BINARY_HASH)
    STAGE = "observer_credentials"
    service_cookie = protected(installation / "state/service.cookie", uid)
    require(re.fullmatch(r"__nostos__:[a-f0-9]{64}", service_cookie))
    STAGE = "node_credentials"
    node_cookie = protected(Path("/home/ubuntu/nostos/mainnet/node-rpc/.cookie"), uid)
    STAGE = "node_identity"
    verify_chain(node_cookie)
    STAGE = "available_ports"
    for port in (3108, 38235):
        with socket.socket() as check:
            check.bind(("127.0.0.1", port))
    STAGE = "mail_configuration"
    inspected = json.loads(subprocess.check_output(["docker", "inspect", "nostos-web"], stderr=subprocess.DEVNULL, text=True))[0]
    existing = dict(item.split("=", 1) for item in inspected["Config"]["Env"] if "=" in item)
    mail = {key: existing.get(key, "") for key in ("NOSTOS_EMAIL_API_KEY", "NOSTOS_EMAIL_FROM")}
    mail_file = Path("/home/ubuntu/nostos/email.env")
    if mail_file.exists():
        for line in protected(mail_file, uid).splitlines():
            key, separator, value = line.partition("=")
            if separator and key in mail:
                mail[key] = value
    STAGE = "saved_import"
    journal = installation / "private-import/plan.sqlite"
    protected_file(journal, uid)
    with sqlite3.connect(journal.as_uri() + "?mode=ro", uri=True) as db:
        birthday, account = db.execute("SELECT birthday,account FROM plan WHERE id=1").fetchone()
    require(type(birthday) is int and birthday > 0 and isinstance(account, str) and account)
    env = settings(mail)
    STAGE = "runtime_files"
    runtime = review / "runtime"
    # Existing settings are never overwritten or regenerated, including after interruption.
    runtime.mkdir(mode=0o700)
    os.chown(runtime, uid, gid)
    for name in ("data", "rpc"):
        path = runtime / name
        path.mkdir(mode=0o700)
        os.chown(path, uid, gid)
    create_private(runtime / "rpc/node.cookie", node_cookie, uid, gid)
    create_private(runtime / "rpc/service.cookie", service_cookie, uid, gid)
    create_private(runtime / "web.env", "".join(k + "=" + v + "\n" for k, v in env.items()), uid, gid)
    create_private(runtime / "observer-config.json", json.dumps(dict(
        root=str(installation / "state"), binary=str(binary), binarySha256=BINARY_HASH, port=38235)), uid, gid)
    print(json.dumps(dict(prepared=True, revision=REVISION, private_preview=True, wallet_birthday=birthday,
        payments_enabled=False, signing_enabled=False, services_changed=False, sends_requested=0)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--installation", type=Path, required=True)
    parser.add_argument("--uid", type=int, required=True)
    parser.add_argument("--gid", type=int, required=True)
    args = parser.parse_args()
    try:
        prepare(args.review, args.installation, args.uid, args.gid)
    except Exception:
        print(json.dumps(dict(prepared=False, stage=STAGE, services_changed=False, sends_requested=0,
            message="Nothing was started. Preserve any existing runtime directory; do not delete or rotate it.")))
        raise SystemExit(1) from None
