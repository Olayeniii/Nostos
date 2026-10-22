"""Synthetic ELF header only. No executable or wallet material is used."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import struct
import sys
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


security = module("transport_security", ROOT / "scripts/lightclient/transport_security.py")
sys.modules['transport_security'] = security
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
            lock.write_text('version = 4\n' + ''.join(
                '\n[[package]]\nname = "' + name + '"\nversion = "' + version + '"\n'
                'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
                'checksum = "' + checksum + '"\n'
                for name, (_, version, _, checksum) in security.PINS.items()))
            with patch.dict(os.environ, GITHUB_SHA="1" * 40, GITHUB_RUN_ID="123"), contextlib.redirect_stdout(io.StringIO()):
                packager.package(binary, lock, root / "bundle")
            artifact = root / "fixture.zip"
            with zipfile.ZipFile(artifact, "w") as output:
                for file in (root / "bundle").iterdir():
                    output.write(file, file.name)
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            proof = inspector.verify(artifact, "1" * 40, digest)
            self.assertTrue(proof["artifact_verified"])
            self.assertEqual(proof['transport_versions']['rustls'], '0.23.46')
            self.assertFalse(proof["extracted"])
            for revision, checksum in [("2" * 40, digest), ("1" * 40, "0" * 64)]:
                with self.assertRaises(ValueError):
                    inspector.verify(artifact, revision, checksum)
            with zipfile.ZipFile(artifact, "a") as output:
                output.writestr("../wallet.sqlite", b"public malformed fixture")
            with self.assertRaises(ValueError):
                inspector.verify(artifact, "1" * 40, hashlib.sha256(artifact.read_bytes()).hexdigest())
            self.assertFalse((root / "wallet.sqlite").exists())


if __name__ == "__main__":
    unittest.main()
