import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('observer_package', Path(__file__).with_name('package-arm64.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ArtifactScope(unittest.TestCase):
    def test_rejects_wrong_architecture_without_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            binary=root/'binary'
            binary.write_bytes(b'not an ARM executable')
            with self.assertRaises(ValueError):
                MODULE.package(binary, root/'output')
            self.assertFalse((root/'output').exists())

    def test_packages_only_the_binary_and_provenance(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'123'}):
            root=Path(directory)
            binary=root/'binary'
            header=bytearray(64)
            header[:6]=b'\x7fELF\x02\x01'
            struct.pack_into('<H',header,18,183)
            binary.write_bytes(header)
            (root/'wallet.db').write_text('private fixture never include')
            MODULE.package(binary,root/'output')
            with tarfile.open(root/'output/nostos-observer-arm64.tar.gz') as archive:
                self.assertEqual(archive.getnames(),['zallet-zaino','provenance.json'])
                self.assertEqual(archive.extractfile('zallet-zaino').read(),header)
            metadata=json.loads((root/'output/provenance.json').read_text())
            self.assertEqual(metadata['binary_sha256'],hashlib.sha256(header).hexdigest())
            self.assertFalse(metadata['wallet_files_included'])
            self.assertEqual(metadata['sends_requested'],0)

    def test_refuses_overwriting_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            binary=root/'binary'
            header=bytearray(64)
            header[:6]=b'\x7fELF\x02\x01'
            struct.pack_into('<H',header,18,183)
            binary.write_bytes(header)
            (root/'output').mkdir()
            (root/'output/preserve.txt').write_text('keep')
            with self.assertRaises(FileExistsError):
                MODULE.package(binary,root/'output')
            self.assertEqual((root/'output/preserve.txt').read_text(),'keep')


if __name__ == '__main__':
    unittest.main()
