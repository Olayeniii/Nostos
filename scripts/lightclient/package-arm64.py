"""Package the checked SDK worker and a fixed list of source files, never runtime state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import tarfile
from transport_security import provenance as transport_provenance

PIN = "987382f67e622915228686e9f956c6a9c9a7514c"
FILES = ("service.mjs", "run-service.mjs", "node-runtime.mjs", "backup.py")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def package(binary, lock, output):
    if not binary.is_file() or binary.is_symlink():
        raise ValueError("Regular binary required")
    with binary.open("rb") as stream:
        header = stream.read(64)
    if len(header) != 64 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 183:
        raise ValueError("Ubuntu ARM64 ELF required")
    source = Path(__file__).parent
    files = {"nostos-sdk-worker": binary, **{name: source / name for name in FILES}}
    for path in files.values():
        if not path.is_file() or path.is_symlink():
            raise ValueError("Regular package sources required")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = dict(format="nostos-sdk-preview-arm64-v1", architecture="aarch64", build_os="ubuntu-24.04",
                    upstream_pin=PIN, nostos_revision=os.environ["GITHUB_SHA"], workflow_run_id=os.environ["GITHUB_RUN_ID"],
                    files={name: digest(path) for name, path in files.items()},
                    wallet_files_included=False, credentials_included=False, services_changed=False,
                    production_enabled=False, sends_requested=0, **transport_provenance(lock))
    metadata = output / "provenance.json"
    metadata.write_text(json.dumps(manifest, indent=2) + "\n")
    archive = output / "nostos-sdk-preview-arm64.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        for name, path in {**files, "provenance.json": metadata}.items():
            info = bundle.gettarinfo(str(path), arcname=name)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o755 if name == "nostos-sdk-worker" else 0o644
            with path.open("rb") as stream:
                bundle.addfile(info, stream)
    (output / "SHA256SUMS").write_text(digest(archive) + "  " + archive.name + "\n")
    print(json.dumps(dict(architecture="aarch64", package_created=True, wallet_files_included=False,
                         services_changed=False, sends_requested=0)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("lock", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.binary, args.lock, args.output)
