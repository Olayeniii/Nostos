"""Synthetic ELF header only. No executable or wallet material is used."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


packager = module("sdk_packager", ROOT / "scripts/lightclient/package-arm64.py")
inspector = module("sdk_inspector", ROOT / "scripts/web/inspect-sdk-package.py")


class PackageTests(unittest.TestCase):
    def test_exact_artifact_and_tamper_refusals_without_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "public-fixture"
            header = bytearray(64)
            header[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", header, 18, 183)
            binary.write_bytes(header)
            lock = root / "lock"
            lock.write_text("public fixture")
            with patch.dict(os.environ, GITHUB_SHA="1" * 40, GITHUB_RUN_ID="123"), contextlib.redirect_stdout(io.StringIO()):
                packager.package(binary, lock, root / "bundle")
            artifact = root / "fixture.zip"
            with zipfile.ZipFile(artifact, "w") as output:
                for file in (root / "bundle").iterdir():
                    output.write(file, file.name)
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            proof = inspector.verify(artifact, "1" * 40, digest)
            self.assertTrue(proof["artifact_verified"])
            self.assertFalse(proof["extracted"])
            for revision, checksum in [("2" * 40, digest), ("1" * 40, "0" * 64)]:
                with self.assertRaises(ValueError):
                    inspector.verify(artifact, revision, checksum)
            with zipfile.ZipFile(artifact, "a") as output:
                output.writestr("../wallet.sqlite", b"public malformed fixture")
            with self.assertRaises(ValueError):
                inspector.verify(artifact, "1" * 40, hashlib.sha256(artifact.read_bytes()).hexdigest())
            self.assertFalse((root / "wallet.sqlite").exists())

    def test_local_origin_is_explicit_and_wrong_cpu_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary, lock = root / "binary", root / "lock"
            header = bytearray(64)
            header[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", header, 18, 62)
            binary.write_bytes(header)
            lock.write_text("synthetic local fixture")
            with self.assertRaises(ValueError):
                packager.package(binary, lock, root / "wrong", local_revision="1" * 40)
            self.assertFalse((root / "wrong").exists())
            struct.pack_into("<H", header, 18, 183)
            binary.write_bytes(header)
            with contextlib.redirect_stdout(io.StringIO()):
                packager.package(binary, lock, root / "bundle", local_revision="1" * 40)
            artifact = root / "local.zip"
            with zipfile.ZipFile(artifact, "w") as output:
                for file in (root / "bundle").iterdir():
                    output.write(file, file.name)
            proof = inspector.verify(artifact, "1" * 40, hashlib.sha256(artifact.read_bytes()).hexdigest())
            self.assertEqual(proof["build_origin"], "local")
            self.assertIsNone(proof["workflow_run_id"])

    def test_local_builder_requires_matching_host_and_clean_exact_checkouts(self):
        builder = module("local_sdk_builder", ROOT / "scripts/lightclient/build-local-arm64.py")
        builder.validate_host("aarch64", dict(ID="ubuntu", VERSION_ID="24.04"))
        for machine, release in [("x86_64", dict(ID="ubuntu", VERSION_ID="24.04")), ("aarch64", dict(ID="ubuntu", VERSION_ID="22.04"))]:
            with self.assertRaises(ValueError):
                builder.validate_host(machine, release)
        with patch.object(builder, "git", side_effect=["1" * 40, " M file"]):
            with self.assertRaises(ValueError):
                builder.validate_checkout(ROOT, "1" * 40)
        with patch.object(builder, "git", return_value="2" * 40):
            with self.assertRaises(ValueError):
                builder.validate_checkout(ROOT, "1" * 40)


if __name__ == "__main__":
    unittest.main()
