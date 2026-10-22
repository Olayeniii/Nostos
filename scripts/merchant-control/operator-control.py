#!/usr/bin/env python3
"""Private operator terminal. No signing, spending-key intake or service control."""
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import warnings

FILES = {"nostos-control-check", "journal.js", "verification.js", "operator.mjs",
         "node-runtime.mjs", "operator-control.py", "package.json"}
PROFILE = {"operator.lock", "binding.key", "attempt.enc", "attempt.enc.tmp",
           "control.sqlite", "control.sqlite-wal", "control.sqlite-shm", "control.sqlite-journal", "wallet"}


def failed():
    return dict(nostos_control_v1=True, passed=False, prepared=False, reserved=False,
                confirmed=False, reopened=False, spending_control_proven=False,
                outgoing_recovery_proven=False)


def regular(path, private=False):
    s = path.lstat()
    if (not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_nlink != 1
            or s.st_mode & (0o077 if private else 0o022)):
        raise ValueError()
    return s


def package(root, expected):
    if not root.is_absolute() or root.resolve() != root or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError()
    for p in [root, *root.parents]:
        s = p.lstat()
        if (not stat.S_ISDIR(s.st_mode) or s.st_uid not in (0, os.getuid())
                or (s.st_mode & 0o022 and not (s.st_uid == 0 and s.st_mode & stat.S_ISVTX))):
            raise ValueError()
        if p == root and (s.st_uid != os.getuid() or s.st_mode & 0o077):
            raise ValueError()
    metadata = root / "provenance.json"
    regular(metadata)
    raw = metadata.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError()
    p = json.loads(raw)
    if (p.get("format") != "nostos-private-control-v1" or p.get("sdk_commit") != "987382f67e622915228686e9f956c6a9c9a7514c"
            or set(p.get("sha256", {})) != FILES or p.get("signing_supported") is not False
            or p.get("wallet_files_included") is not False):
        raise ValueError()
    for name, digest in p["sha256"].items():
        target = root / name
        regular(target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError()
    if not os.access(root / "nostos-control-check", os.X_OK):
        raise ValueError()
    return p


def profile(root, create):
    if not root.is_absolute():
        raise ValueError()
    if create and not root.exists():
        root.mkdir(mode=0o700)
    if root.resolve() != root:
        raise ValueError()
    for p in [root, *root.parents]:
        s = p.lstat()
        if (not stat.S_ISDIR(s.st_mode) or s.st_uid not in (0, os.getuid())
                or (s.st_mode & 0o022 and not (s.st_uid == 0 and s.st_mode & stat.S_ISVTX))):
            raise ValueError()
        if p == root and (s.st_uid != os.getuid() or s.st_mode & 0o077):
            raise ValueError()
    for p in root.iterdir():
        if p.name not in PROFILE:
            raise ValueError()
        if p.name == "wallet":
            s = p.lstat()
            if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
                raise ValueError()
        else:
            regular(p, True)


def node_runtime():
    node = shutil.which("node")
    if not node:
        raise ValueError()
    result = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5)
    match = re.fullmatch(r"v24\.(\d+)\.(\d+)\s*", result.stdout)
    if result.returncode or not match or (int(match[1]), int(match[2])) < (22, 1):
        raise ValueError()
    return node


def resource_scope():
    entries = Path("/proc/self/cgroup").read_text().splitlines()
    relative = next(line[3:] for line in entries if line.startswith("0::"))
    base = Path("/sys/fs/cgroup").resolve(strict=True)
    scope = (base / relative.lstrip("/")).resolve(strict=True)
    if not scope.is_relative_to(base):
        raise ValueError()
    memory = (scope / "memory.max").read_text().strip()
    cpu = (scope / "cpu.max").read_text().split()
    if (not memory.isdigit() or not 0 < int(memory) <= 2 * 1024**3
            or len(cpu) != 2 or any(not p.isdigit() for p in cpu)
            or not 0 < int(cpu[0]) <= int(cpu[1]) // 2):
        raise ValueError()


def hidden(label, maximum=3000):
    value = getpass.getpass(label)
    if len(value) > maximum:
        raise ValueError()
    return value


def run_node(arguments, inputs):
    process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True, start_new_session=True, env={"LANG": "C"})
    try:
        output, _ = process.communicate(json.dumps(inputs), timeout=1250)
        return subprocess.CompletedProcess(arguments, process.returncode, stdout=output, stderr="")
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


def invoke(node, root, mode, target, digest, inputs):
    child = run_node([node, "--max-old-space-size=128", str(root / "operator.mjs"), mode, str(target), digest], inputs)
    if len(child.stdout) > 4096:
        raise ValueError()
    report = json.loads(child.stdout)
    handoff = report.pop("handoff", None)
    if set(report) != set(failed()) or any(type(v) is not bool for v in report.values()) or report["nostos_control_v1"] is not True:
        raise ValueError()
    expected = failed()
    if mode == "prepare":
        expected.update(passed=True, prepared=True)
    elif mode == "handoff":
        expected.update(passed=True, prepared=True, reserved=True)
    else:
        expected.update(passed=True, prepared=True, reserved=True, confirmed=True,
                        reopened=True, spending_control_proven=True, outgoing_recovery_proven=True)
    if child.returncode != 0 or report != expected:
        raise ValueError()
    if mode == "handoff":
        if (not isinstance(handoff, dict) or set(handoff) != {"receiver", "memo", "amountZat", "maxFeeZat", "maxDebitZat"}
                or not re.fullmatch(r"u1[a-z0-9]{20,500}", handoff.get("receiver", ""))
                or not re.fullmatch(r"nostos:control:[a-f0-9]{32}", handoff.get("memo", ""))
                or handoff.get("amountZat") != 10000 or handoff.get("maxFeeZat") != 10000
                or handoff.get("maxDebitZat") != 20000):
            raise ValueError()
        # Explicit local review only. Never a customer refund route or viewing key.
        sys.stderr.write("\nPRIVATE CONTROL REVIEW - recording must be off\n"
                         "Shielded receiver: " + handoff["receiver"] + "\n"
                         "Message: " + handoff["memo"] + "\n"
                         "Amount: 0.00010000 ZEC; fee cap: 0.00010000 ZEC; gross input cap: 0.00020000 ZEC\n"
                         "Reservation saved. Sign once only after the separately approved plan matches.\n")
    elif handoff is not None:
        raise ValueError()
    return report


def main():
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if len(sys.argv) != 5 or not sys.stdin.isatty() or not sys.stderr.isatty():
            raise ValueError()
        mode, package_path, profile_path, reviewed_hash = sys.argv[1:]
        if mode not in {"prepare", "handoff", "verify", "recheck"}:
            raise ValueError()
        root, target = Path(package_path), Path(profile_path)
        manifest = package(root, reviewed_hash)
        node = node_runtime()  # Refuse an old Node before asking for any key.
        resource_scope()  # Require actual cgroup memory/CPU limits before key entry.
        profile(target, mode == "prepare")
        lock_path = target / "operator.lock"
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "r+") as lock:
            regular(lock_path, True)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            warnings.simplefilter("error", getpass.GetPassWarning)
            inputs = {}
            if mode == "prepare":
                for field, label in [("senderUfvk", "Business FULL viewing key (hidden): "),
                                     ("senderAddress", "Same business account receive UA (hidden): "),
                                     ("receiverUfvk", "Second controlled account FULL viewing key (hidden, memory only): "),
                                     ("receiverAddress", "Same second account receive UA (hidden): ")]:
                    inputs[field] = hidden(label)
                if any(not inputs[k].startswith("uview1") for k in ("senderUfvk", "receiverUfvk")):
                    raise ValueError()
                inputs["birthday"] = int(hidden("Approved scan birthday height (hidden): ", 10))
            elif mode == "handoff":
                inputs["approvalId"] = hidden("Separate funded-control approval reference: ", 64)
            elif mode == "verify":
                inputs["txid"] = hidden("Existing control transaction ID (hidden; do not send again): ", 64)
            result = invoke(node, root, mode, target, manifest["sha256"]["nostos-control-check"], inputs)
            inputs.clear()
            profile(target, False)
            print(json.dumps(result, sort_keys=True))
            return 0
    except (Exception, KeyboardInterrupt):
        print(json.dumps(failed(), sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
