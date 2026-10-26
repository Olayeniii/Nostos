import hashlib
import importlib.util
from pathlib import Path
import platform
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('control_package', Path(__file__).with_name('package-control.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def test_package_contains_only_fixed_public_files_with_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / 'worker'
            header = bytearray(20)
            header[:6] = b'\x7fELF\x02\x01'
            machine = {'x86_64': 62, 'aarch64': 183}[platform.machine()]
            header[18:20] = machine.to_bytes(2, 'little')
            binary.write_bytes(header)
            result = module.package(binary, root / 'out', 'a' * 40)
            self.assertFalse(result['live_proof'])
            self.assertFalse(result['signing_supported'])
            self.assertEqual(set(p.name for p in (root / 'out').iterdir()),
                             {'nostos-sdk-worker', 'control.py', 'CONTROL_TEST.md', 'provenance.json'})
            for name, digest in result['sha256'].items():
                self.assertEqual(hashlib.sha256((root / 'out' / name).read_bytes()).hexdigest(), digest)

    def test_invalid_binary_or_commit_cannot_create_package(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            binary = root / 'worker'
            binary.write_bytes(b'not a native worker')
            for commit in ['a' * 40, 'invalid']:
                with self.assertRaises(ValueError):
                    module.package(binary, root / 'out', commit)
                self.assertFalse((root / 'out').exists())


if __name__ == '__main__':
    unittest.main()
