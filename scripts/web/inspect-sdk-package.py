#!/usr/bin/env python3
"""Verify a downloaded SDK artifact without extracting or running its contents."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import tarfile
import zipfile

PIN = "987382f67e622915228686e9f956c6a9c9a7514c"
LIMIT = 256 * 1024 * 1024
ARCHIVE = "nostos-sdk-preview-arm64.tar.gz"
CONTENTS = {"nostos-sdk-worker", "service.mjs", "run-service.mjs", "backup.py", "provenance.json"}


def require(condition):
    if not condition:
        raise ValueError("artifact_verification_failed")


def verify(path, revision, artifact_sha256):
    require(re.fullmatch(r"[a-f0-9]{40}", revision) and re.fullmatch(r"[a-f0-9]{64}", artifact_sha256))
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= LIMIT)
    with path.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == artifact_sha256)
    with zipfile.ZipFile(path) as artifact:
        entries = artifact.infolist()
        require(len(entries) == 3 and {e.filename for e in entries} == {ARCHIVE, "provenance.json", "SHA256SUMS"})
        require(sum(e.file_size for e in entries) <= LIMIT)
        require(all(not e.is_dir() and not ((e.external_attr >> 16) & 0o170000) == 0o120000 for e in entries))
        require(artifact.getinfo("provenance.json").file_size <= 16384 and artifact.getinfo("SHA256SUMS").file_size <= 256)
        archive = artifact.read(ARCHIVE)
        provenance = artifact.read("provenance.json")
        sums = artifact.read("SHA256SUMS").decode("ascii")
    require(sums == hashlib.sha256(archive).hexdigest() + "  " + ARCHIVE + "\n")
    manifest = json.loads(provenance)
    require(manifest["format"] == "nostos-sdk-preview-arm64-v1" and manifest["nostos_revision"] == revision)
    require(manifest["upstream_pin"] == PIN and manifest["architecture"] == "aarch64" and manifest["build_os"] == "ubuntu-24.04")
    require(all(manifest[key] is False for key in ("wallet_files_included", "credentials_included", "services_changed", "production_enabled")))
    require(manifest["sends_requested"] == 0)
    origin = manifest.get("build_origin", "github-actions")
    require(origin in ("local", "github-actions"))
    require(manifest["workflow_run_id"] is None if origin == "local" else str(manifest["workflow_run_id"]).isdigit())
    require(re.fullmatch(r"[a-f0-9]{64}", manifest["prepared_lock_sha256"]))
    require(set(manifest["files"]) == CONTENTS - {"provenance.json"})
    require(all(re.fullmatch(r"[a-f0-9]{64}", value) for value in manifest["files"].values()))
    seen = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r|gz") as bundle:
        for member in bundle:
            require(member.name in CONTENTS and member.name not in seen and member.isfile())
            require(member.mode == (0o755 if member.name == "nostos-sdk-worker" else 0o644))
            total += member.size
            require(0 < member.size <= LIMIT and total <= LIMIT)
            seen.add(member.name)
            stream = bundle.extractfile(member)
            if member.name == "provenance.json":
                require(member.size == len(provenance) and stream.read(16385) == provenance)
                continue
            digest = hashlib.sha256()
            header = stream.read(64)
            digest.update(header)
            if member.name == "nostos-sdk-worker":
                require(len(header) == 64 and header[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", header, 18)[0] == 183)
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
            require(digest.hexdigest() == manifest["files"][member.name])
    require(seen == CONTENTS)
    return dict(read_only=True, artifact_verified=True, revision=revision, architecture="aarch64",
                workflow_run_id=manifest["workflow_run_id"], build_origin=origin, binary_sha256=manifest["files"]["nostos-sdk-worker"],
                extracted=False, executable_started=False, services_changed=False, sends_requested=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--artifact-sha256", required=True, help="Trusted artifact digest, without sha256: prefix")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.artifact, args.revision, args.artifact_sha256)))
    except Exception:
        print(json.dumps(dict(read_only=True, artifact_verified=False, services_changed=False, sends_requested=0)))
        raise SystemExit(1)
