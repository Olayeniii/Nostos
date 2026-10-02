"""Set separate receipt access while preserving the current web container config."""
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import socket
import time
import urllib.request


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect("/var/run/docker.sock")


def docker(method, path, payload=None):
    connection = DockerConnection("localhost", timeout=30)
    try:
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        data = response.read()
        if response.status >= 400:
            raise RuntimeError("Docker operation failed (HTTP %d)." % response.status)
        return json.loads(data) if data else None
    finally:
        connection.close()


def run():
    current = docker("GET", "/containers/nostos-web/json")
    config = current["Config"]
    env = dict(entry.split("=", 1) for entry in config["Env"] if "=" in entry)
    key_path = Path.home() / "nostos" / "receipt-access.key"
    existing = env.get("NOSTOS_RECEIPT_SECRET", "")
    saved = key_path.read_text().strip() if key_path.exists() else ""
    for key in (existing, saved):
        if key and not re.fullmatch(r"[a-f0-9]{64}", key):
            raise RuntimeError("Receipt key is invalid; no configuration was changed.")
    if existing and saved and existing != saved:
        raise RuntimeError("Receipt keys disagree; no configuration was changed.")
    key = existing or saved or secrets.token_hex(32)
    if not saved:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write(key + "\n")
    os.chmod(key_path, 0o600)
    if existing:
        docker("POST", "/containers/nostos-web/restart?t=30")
        print("Receipt access preserved. Web container restarted for the new build.")
        return
    config["Env"] = [entry for entry in config["Env"] if not entry.startswith("NOSTOS_RECEIPT_SECRET=")] + ["NOSTOS_RECEIPT_SECRET=" + key]
    config["HostConfig"] = current["HostConfig"]
    suffix = str(int(time.time()))
    candidate = "nostos-web-receipts-" + suffix
    backup = "nostos-web-before-receipts-" + suffix
    created = docker("POST", "/containers/create?name=" + candidate, config)
    if created.get("Warnings"):
        raise RuntimeError("Replacement container has warnings; original left running.")
    renamed = False
    swapped = False
    try:
        docker("POST", "/containers/nostos-web/stop?t=30")
        docker("POST", "/containers/nostos-web/rename?name=" + backup)
        renamed = True
        docker("POST", "/containers/" + candidate + "/rename?name=nostos-web")
        swapped = True
        docker("POST", "/containers/nostos-web/start")
        for _ in range(40):
            try:
                with urllib.request.urlopen("http://127.0.0.1:3000/merchant", timeout=1) as response:
                    if response.status == 200:
                        print("Receipt access configured. Merchant page is healthy.")
                        print("Private receipt key stays on the VPS. Do not share it.")
                        return
            except (OSError, TimeoutError):
                pass
            time.sleep(0.5)
        raise RuntimeError("Replacement web container did not become healthy.")
    except Exception:
        if swapped:
            try:
                docker("POST", "/containers/nostos-web/stop?t=10")
                docker("POST", "/containers/nostos-web/rename?name=" + candidate)
            except Exception:
                pass
        if renamed:
            docker("POST", "/containers/" + backup + "/rename?name=nostos-web")
        docker("POST", "/containers/nostos-web/start")
        raise RuntimeError("Configuration failed. Original container configuration was restored.") from None


if __name__ == "__main__":
    try:
        run()
    except Exception:
        raise SystemExit("Receipt configuration failed. No wallet operations were performed. Check nostos-web status before retrying.") from None
