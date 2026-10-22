"""Security-policy failures must precede artifact creation. Public metadata only."""
import copy
import tempfile
import tomllib
from pathlib import Path
import unittest
import transport_security as security


def fixture():
    return "version = 4\n" + "".join(
        '\n[[package]]\nname = "' + name + '"\nversion = "' + old + '"\n'
        'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
        'checksum = "' + digest + '"\n'
        for name, (old, _, digest, _) in security.PINS.items()) + (
        '\n[[package]]\nname = "zcash_keys"\nversion = "0.14.0"\n'
        'source = "git+https://example.invalid/pinned#unchanged"\n')


class TransportSecurityTests(unittest.TestCase):
    def test_only_reviewed_transport_fields_change_and_repeat_is_safe(self):
        original = fixture()
        updated = security.update_lock(original)
        expected = copy.deepcopy(tomllib.loads(original))
        for package in expected["package"]:
            if package["name"] in security.PINS:
                _, package["version"], _, package["checksum"] = security.PINS[package["name"]]
        self.assertEqual(tomllib.loads(updated), expected)
        self.assertEqual(security.update_lock(updated), updated)

    def test_changed_checksum_source_or_duplicate_package_is_refused(self):
        for bad in [fixture().replace(security.PINS['rustls'][2], '0' * 64),
                    fixture().replace('registry+https://github.com/rust-lang/crates.io-index', 'git+unreviewed'),
                    fixture() + '\n[[package]]\nname = "rustls"\nversion = "0.23.41"\n']:
            with self.assertRaises(ValueError):
                security.update_lock(bad)

    def test_invalid_second_lock_leaves_first_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'backends/zaino').mkdir(parents=True)
            first = root / 'Cargo.lock'
            first.write_text(fixture())
            (root / 'backends/zaino/Cargo.lock').write_text('version = 4\npackage = []\n')
            with self.assertRaises(ValueError):
                security.prepare(root)
            self.assertEqual(first.read_text(), fixture())

    def test_provenance_refuses_old_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / 'Cargo.lock'
            lock.write_text(fixture())
            with self.assertRaises(ValueError):
                security.provenance(lock)
            lock.write_text(security.update_lock(fixture()))
            self.assertEqual(security.provenance(lock)['transport_versions']['rustls'], '0.23.46')


if __name__ == '__main__':
    unittest.main()
