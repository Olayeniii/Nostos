"""Fixed-file standalone operator package; no wallet or user files are accepted."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import struct
import subprocess
from transport_security import provenance as transport_provenance


def package(binary, compiled, lock, output):
    if not binary.is_file() or binary.is_symlink():
        raise ValueError("Regular executable required")
    header = binary.read_bytes()[:64]
    architecture = platform.machine()
    machine = {"x86_64": 62, "aarch64": 183}.get(architecture)
    if (len(header) != 64 or header[:6] != b"\x7fELF\x02\x01"
            or machine is None or struct.unpack_from("<H", header, 18)[0] != machine):
        raise ValueError("Native Linux ELF required")
    source = Path(__file__).resolve().parent
    operator = source.parent / "merchant-control"
    sources = {"nostos-control-check": binary, "journal.js": compiled / "journal.js",
               "verification.js": compiled / "verification.js", "operator.mjs": operator / "operator.mjs",
               "operator-control.py": operator / "operator-control.py", "node-runtime.mjs": source / "node-runtime.mjs"}
    for path in sources.values():
        if not path.is_file() or path.is_symlink():
            raise ValueError("Regular fixed-file sources required")
    policy = transport_provenance(lock)
    output.mkdir(mode=0o700, exist_ok=False)
    for name, path in sources.items():
        shutil.copyfile(path, output / name)
        (output / name).chmod(0o700 if name == "nostos-control-check" else 0o600)
    (output / "package.json").write_text('{"type":"module"}\n')
    (output / "package.json").chmod(0o600)
    names = [*sources, "package.json"]
    hashes = {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in names}
    metadata = dict(format="nostos-private-control-v1", machine=architecture, build_os="ubuntu-24.04",
                    sdk_commit="987382f67e622915228686e9f956c6a9c9a7514c",
                    librustzcash_commit="1f6bb2072e7fcb142b0d90ff7b267a8699a84818",
                    nostos_commit=subprocess.check_output(["git", "-C", str(source.parents[1]), "rev-parse", "HEAD"], text=True).strip(),
                    sha256=hashes, network_required=True, signing_supported=False,
                    wallet_files_included=False, credentials_included=False, sends_requested=0,
                    **policy)
    manifest = output / "provenance.json"
    manifest.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    manifest.chmod(0o600)
    manifest_hash = hashlib.sha256(manifest.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(manifest_hash + "  provenance.json\n" +
                                      "".join(value + "  " + name + "\n" for name, value in hashes.items()))
    (output / "SHA256SUMS").chmod(0o600)
    print(json.dumps(dict(provenance_sha256=manifest_hash, **metadata), sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("binary", "compiled", "lock", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    package(args.binary, args.compiled, args.lock, args.output)
