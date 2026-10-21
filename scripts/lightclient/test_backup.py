"""All keys and records in these tests are disposable, never funded fixtures."""
import fcntl
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
import backup

MERCHANT = "4b723cba-3e4d-4536-9c2e-e8129e2fb731"
OTHER = "5b723cba-3e4d-4536-9c2e-e8129e2fb731"


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.base.chmod(0o700)
        self.root = self.base / MERCHANT
        self.root.mkdir(mode=0o700)
        self.output = self.base / "copies"
        self.output.mkdir(mode=0o700)
        with backup.open_private(self.root / "wallet.sqlite"):
            pass
        self.db = sqlite3.connect(self.root / "wallet.sqlite")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE accounts (value TEXT)")
        self.db.execute("CREATE TABLE transactions (memo TEXT)")
        self.db.execute("INSERT INTO transactions VALUES ('public-test-memo-only')")
        self.db.commit()
        # WAL is present and contains the committed insert at snapshot time.
        self.assertTrue((self.root / "wallet.sqlite-wal").exists())

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_snapshot_includes_committed_wal_and_excludes_uncommitted_write(self):
        self.db.execute("INSERT INTO transactions VALUES ('uncommitted')")
        data = backup.snapshot(self.root)
        memory = sqlite3.connect(":memory:")
        memory.deserialize(data)
        self.assertEqual(memory.execute("SELECT memo FROM transactions").fetchall(), [("public-test-memo-only",)])
        memory.close()
        self.db.rollback()

    def test_active_writer_and_unsafe_paths_are_rejected(self):
        with backup.open_private(self.root / "writer.lock") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                backup.snapshot(self.root)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):
            backup.snapshot(self.root)
        self.root.chmod(0o700)
        link = self.root / "wallet.sqlite-journal"
        link.symlink_to(self.root / "wallet.sqlite")
        with self.assertRaises(ValueError):
            backup.snapshot(self.root)

    @unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen"), "age tools required")
    def test_real_encrypted_restore_and_refusals(self):
        identity = self.output / "identity"
        with backup.open_private(identity) as stream:
            subprocess.run(["age-keygen"], stdout=stream, stderr=subprocess.DEVNULL, check=True)
        recipient = subprocess.run(["age-keygen", "-y", str(identity)], stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, check=True).stdout.decode().strip()
        archive = self.output / "snapshot.age"
        backup.backup(self.root, archive, recipient, MERCHANT)
        self.assertNotIn(b"public-test-memo-only", archive.read_bytes())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        restored_parent = self.base / "restored"
        restored_parent.mkdir(mode=0o700)
        restored = restored_parent / MERCHANT
        backup.restore(archive, restored, identity, MERCHANT)
        recovered = sqlite3.connect(restored / "wallet.sqlite")
        self.assertEqual(recovered.execute("SELECT memo FROM transactions").fetchall(), [("public-test-memo-only",)])
        recovered.close()
        self.assertEqual((restored / "wallet.sqlite").stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            backup.restore(archive, restored, identity, MERCHANT)
        with self.assertRaises(FileExistsError):
            backup.backup(self.root, archive, recipient, MERCHANT)
        with self.assertRaises(ValueError):
            backup.restore(archive, restored_parent / OTHER, identity, OTHER)
        self.assertFalse((restored_parent / OTHER).exists())
        damaged = self.output / "damaged.age"
        data = bytearray(archive.read_bytes())
        data[-1] ^= 1
        with backup.open_private(damaged) as stream:
            stream.write(data)
        another = self.base / "damaged-target"
        another.mkdir(mode=0o700)
        with self.assertRaises(ValueError):
            backup.restore(damaged, another / MERCHANT, identity, MERCHANT)
        self.assertFalse((another / MERCHANT).exists())
        self.assertEqual(sorted(p.name for p in self.output.iterdir()), ["damaged.age", "identity", "snapshot.age"])


if __name__ == "__main__":
    unittest.main()
