#!/usr/bin/env python3
"""CI-only fixed-file package. Does not enumerate wallet paths or environment."""
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from transport_security import provenance as transport_provenance

binary, output = map(Path, sys.argv[1:])
output.mkdir(mode=0o700, exist_ok=False)
sources = {"nostos-operator-check": binary,
           "operator-check.py": Path(__file__).with_name("operator-check.py")}
hashes = {}
for name, source in sources.items():
    target = output / name
    shutil.copyfile(source, target)
    target.chmod(0o700 if name == "nostos-operator-check" else 0o600)
    hashes[name] = hashlib.sha256(target.read_bytes()).hexdigest()
provenance = {
    "nostos_commit": subprocess.check_output(
        ["git", "-C", str(Path(__file__).resolve().parents[2]), "rev-parse", "HEAD"], text=True).strip(),
    "sdk_commit": "987382f67e622915228686e9f956c6a9c9a7514c",
    "machine": platform.machine(), "libc": platform.libc_ver(),
    "sha256": hashes, "network_required": False, "wallet_database_created": False,
    "signing_supported": False,
    **transport_provenance(Path("Cargo.lock")),
}
(output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
# This is fixed packaging metadata, safe for the CI log. Never accepts user data.
print(json.dumps(provenance, sort_keys=True))
