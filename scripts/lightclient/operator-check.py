#!/usr/bin/env python3
"""Private terminal wrapper. Never pass a key/address in argv, env or a file."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import warnings


def result(passed):
    return {"nostos_offline_binding_v1": True, "passed": passed, "offline": True,
            "key_imported": False, "spending_control_proven": False,
            "outgoing_recovery_proven": False}


def verified_binary(path, digest):
    binary = Path(path)
    if not binary.is_absolute() or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError()
    info = binary.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o022 or not os.access(binary, os.X_OK)):
        raise ValueError()
    if hashlib.sha256(binary.read_bytes()).hexdigest() != digest:
        raise ValueError()
    return str(binary)


def invoke(binary, key, address):
    if len(key) > 3000 or len(address) > 3000:
        raise ValueError()
    completed = subprocess.run([binary], input=json.dumps({"ufvk": key, "address": address}),
                               text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=15, check=False, env={"LANG": "C"})
    if len(completed.stdout) > 512:
        raise ValueError()
    report = json.loads(completed.stdout)
    if type(report) is not dict or any(type(value) is not bool for value in report.values()):
        raise ValueError()
    # Compare the complete report to fixed boolean-only schemas; never echo the
    # child's output, even if it contains an unexpected field or error message.
    if completed.returncode == 0 and report == result(True):
        return result(True)
    if completed.returncode == 1 and report == result(False):
        return result(False)
    raise ValueError()


def main():
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if len(sys.argv) != 3 or not sys.stdin.isatty() or not sys.stderr.isatty():
            raise ValueError()
        binary = verified_binary(sys.argv[1], sys.argv[2])
        warnings.simplefilter("error", getpass.GetPassWarning)
        key = getpass.getpass("Full viewing key (hidden, local memory only): ")
        address = getpass.getpass("Same selected account receive UA (hidden): ")
        report = invoke(binary, key, address)
        del key, address
        print(json.dumps(report, sort_keys=True))
        return 0 if report["passed"] else 1
    except (Exception, KeyboardInterrupt):
        print(json.dumps(result(False), sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
