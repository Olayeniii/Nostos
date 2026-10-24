"""Switch only the private loopback preview to its verified commerce build."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import time
import urllib.error
import urllib.request

REVIEW = Path("/home/ubuntu/nostos-web-review.CEfoZq")
INSTALL = Path("/home/ubuntu/nostos-sdk-isolated.86aLK6")
REVISION = "c370ee2d0ec41a62eb7b2904d5f243bdea2424ca"
BUILD = REVIEW / ("commerce-build-" + REVISION[:12])
HASH = "eb6ccf6ec786b5867f8da84a881c1705fdf155ca5c69c84a6a82253b27e656e7"
OLD_HASH = "4aeb0a96ba9c00c01a1a9d4b5a144de904eae833ff4e455b665650077b063d74"
IMAGE = "sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"
OLD_WEB = "nostos-private-review-settings-04775b7"
NEW_WEB = "nostos-private-review-commerce-c370ee2"


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private(path, directory=False):
    mode = path.lstat()
    require(path.resolve() == path and mode.st_uid == os.getuid() and not mode.st_mode & 0o077,
            "Private preview path ownership or permissions changed: " + path.name)
    require(stat.S_ISDIR(mode.st_mode) if directory else stat.S_ISREG(mode.st_mode) and mode.st_nlink == 1,
            "Unexpected private preview file type.")


def docker(*args):
    return subprocess.run(["docker", *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=50).stdout


def inspect_web():
    old = json.loads(docker("inspect", OLD_WEB))[0]
    require(old["State"]["Running"] and old["Image"] == IMAGE and old["Config"]["User"] == "1001:1001" and old["HostConfig"]["NetworkMode"] == "host",
            "Current private web deployment changed.")
    expected = {
        "/app": (str(REVIEW / "source-settings-04775b7"), False),
        "/preview": (str(REVIEW / "runtime/data"), True),
        "/preview-rpc": (str(REVIEW / "runtime/rpc"), False),
    }
    mounts = {m["Destination"]: (m["Source"], m["RW"]) for m in old["Mounts"]}
    require(mounts == expected, "Current private preview mounts changed.")
    existing = docker("ps", "-a", "--filter", "name=^/" + NEW_WEB + "$", "--format", "{{.ID}}")
    require(not existing.strip(), "Commerce preview container already exists. Preserve it for inspection.")


def broker_pid(launcher, config):
    matches = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
            if len(args) == 3 and args[1:] == [os.fsencode(launcher), os.fsencode(config)]:
                require(proc.stat().st_uid == os.getuid(), "Unexpected broker owner.")
                matches.append(int(proc.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    require(len(matches) == 1, "Expected exactly one current preview broker.")
    return matches[0]


def stop_pid(pid, launcher, config):
    require(broker_pid(launcher, config) == pid, "Broker process changed before switch.")
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            args = (Path("/proc") / str(pid) / "cmdline").read_bytes()
        except FileNotFoundError:
            return
        if not args:
            return
        time.sleep(0.25)
    raise ValueError("Broker is still draining. No force stop was requested.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Preview health check redirected.")


def http(path, port=3108):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open("http://127.0.0.1:" + str(port) + path, timeout=3) as response:
            return response.status, response.read(8192)
    except urllib.error.HTTPError as error:
        return error.code, b""


def wait_for(check, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise ValueError("Private preview health check did not pass.")


def start_broker(node, launcher, config, log):
    with log.open("ab", buffering=0) as output:
        os.chmod(log, 0o600)
        return subprocess.Popen([str(node), str(launcher), str(config)], stdin=subprocess.DEVNULL,
                                stdout=output, stderr=output, start_new_session=True)


def run():
    require(os.getuid() == 1001, "Use the existing ubuntu operator, without sudo.")
    runtime = REVIEW / "runtime"
    for path in (REVIEW, INSTALL, runtime, runtime / "data", BUILD):
        private(path, directory=True)
    for path in (runtime / "web.env", runtime / "observer-config.json", BUILD / "nostos-sdk-worker"):
        private(path)
    source = BUILD / "source"
    private(source, directory=True)
    result = json.loads((BUILD / "build-result.json").read_text())
    require(result.get("revision") == REVISION and result.get("binary_sha256") == HASH and result.get("source") == str(source), "Build report mismatch.")
    binary = BUILD / "nostos-sdk-worker"
    require(digest(binary) == HASH and binary.stat().st_mode & 0o100, "New worker verification failed.")
    require((source / "apps/web/.next/BUILD_ID").is_file() and (source / "apps/web/node_modules/next/dist/bin/next").is_file(), "Web build is incomplete.")
    old_config = runtime / "observer-config.json"
    config = json.loads(old_config.read_text())
    require(config.get("binary") == str(INSTALL / "nostos-sdk-worker") and config.get("binarySha256") == OLD_HASH and config.get("port") == 38235 and config.get("root") == str(INSTALL / "state"), "Current broker configuration changed.")
    require(digest(INSTALL / "nostos-sdk-worker") == OLD_HASH, "Current worker verification failed.")
    cookie = INSTALL / "state/service.cookie"
    private(cookie)
    private(runtime / "rpc/service.cookie")
    require(cookie.read_bytes() == (runtime / "rpc/service.cookie").read_bytes(), "Preview credential copy differs. Preserve existing credentials.")
    launcher = INSTALL / "run-service.mjs"
    require(digest(INSTALL / "service.mjs") == "dc6ccc9414ebd8d02242feaf6133b1c063c1b8512c190b2712d4f546d105beac", "Installed broker code changed.")
    node = Path("/usr/bin/node").resolve()
    pid = broker_pid(launcher, old_config)
    inspect_web()
    next_config = runtime / "observer-config-commerce-c370ee2.json"
    updated = dict(config, binary=str(binary), binarySha256=HASH)
    with next_config.open("x") as output:
        os.chmod(next_config, 0o600)
        output.write(json.dumps(updated) + "\n")
    stopped_broker = False
    stopped_web = False
    child = None
    new_web_attempted = False
    try:
        stop_pid(pid, launcher, old_config)
        stopped_broker = True
        child = start_broker(node, launcher, next_config, REVIEW / "observer-commerce.log")
        wait_for(lambda: child.poll() is None and http("/", 38235)[0] == 401)
        docker("stop", "--time", "30", OLD_WEB)
        stopped_web = True
        new_web_attempted = True
        docker("run", "-d", "--name", NEW_WEB, "--network=host", "--user", "1001:1001",
               "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--memory=1536m",
               "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "--env-file", str(runtime / "web.env"),
               "-e", "NOSTOS_MAINNET_COMMERCE_PREVIEW=yes", "-v", str(source) + ":/app:ro",
               "-v", str(runtime / "data") + ":/preview", "-v", str(runtime / "rpc") + ":/preview-rpc:ro",
               "-w", "/app/apps/web", IMAGE, "node", "/app/apps/web/node_modules/next/dist/bin/next",
               "start", "--hostname", "127.0.0.1", "--port", "3108")
        def healthy():
            status, raw = http("/api/product/network")
            network = json.loads(raw) if status == 200 else {}
            return network == {"network": "mainnet", "commerceEnabled": True} and http("/sign-in")[0] == 200 and http("/api/product/me")[0] == 401 and child.poll() is None
        wait_for(healthy)
        print(json.dumps(dict(installed=True, private_preview=True, revision=REVISION, binary_verified=True,
                              commerce_enabled=True, signing_enabled=False, web_http=200, account_auth_http=401,
                              observer_auth_http=401, existing_data_preserved=True, sends_requested=0)), flush=True)
    except BaseException:
        # Never run two brokers against the same wallet storage.
        if new_web_attempted:
            try:
                active = json.loads(docker("inspect", NEW_WEB))[0]["State"]["Running"]
            except subprocess.CalledProcessError:
                active = False
            if active:
                docker("stop", "--time", "30", NEW_WEB)
        if child is not None and child.poll() is None:
            stop_pid(child.pid, launcher, next_config)
            child.wait(timeout=5)
        if stopped_broker:
            previous = start_broker(node, launcher, old_config, REVIEW / "observer-rollback.log")
            wait_for(lambda: previous.poll() is None and http("/", 38235)[0] == 401)
        if stopped_web:
            docker("start", OLD_WEB)
            wait_for(lambda: http("/sign-in")[0] == 200 and http("/api/product/me")[0] == 401)
        raise


if __name__ == "__main__":
    try:
        lock_path = REVIEW / "commerce-install.lock"
        with lock_path.open("a") as lock:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            run()
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else "Preview switch did not complete. Preserve all data and inspect the current preview processes before retrying."
        print(json.dumps(dict(installed=False, message=message, sends_requested=0)), flush=True)
        raise SystemExit(1)
