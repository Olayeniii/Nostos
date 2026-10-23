"""Synthetic keys and worker responses only. No live import or provider access."""
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("private_import", Path(__file__).with_name("import-empty-account.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ACCOUNT = "afcf8468-1814-4fea-a9f6-ce5a57505078"
DIGEST = "a" * 64
KEY = "uview1synthetic-only-not-a-real-key"


def status(connected=False, tip=3500000, locked=True):
    return dict(nostos_sdk_preview_v1=True, observation_scope="orchard-family-only",
                payments_enabled=False, account_connected=connected, locked=locked,
                node_tip=dict(height=tip))


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.calls = []
        self.fail_import = False

    def tearDown(self):
        self.temp.cleanup()

    def worker(self, binary, wallet, method, params):
        self.calls.append((method, params))
        if method == "z_importviewingkey":
            if self.fail_import:
                raise ValueError("synthetic interruption")
            return dict(nostos_view_only_v1=True, nostos_sdk_preview_v1=True,
                        observation_scope="orchard-family-only", account_uuid=ACCOUNT,
                        address="u1private-output-must-not-escape")
        return status(connected=method == "nostos_sync" or len(self.calls) > 2,
                      locked=method != "nostos_sync" and len(self.calls) <= 2)

    def test_import_reopen_and_repeat_use_same_plan_without_second_key_prompt(self):
        with module.ledger(self.root / "ledger") as db, patch.object(module, "call", side_effect=self.worker):
            report = module.reconcile(db, self.state, Path("/synthetic/binary"), DIGEST, lambda: KEY)
            self.assertTrue(report["sync_ready"])
            self.assertTrue(report["reopened"])
            self.assertNotIn(KEY, str(report))
            self.assertNotIn(ACCOUNT, str(report))
            self.assertEqual(self.calls[1], ("z_importviewingkey", [KEY, "whenkeyisnew", 3499900]))
        with module.ledger(self.root / "ledger") as db, patch.object(module, "call", side_effect=self.worker):
            module.reconcile(db, self.state, Path("/synthetic/binary"), DIGEST,
                             lambda: self.fail("must not prompt again"))
        self.assertEqual(sum(method == "z_importviewingkey" for method, _ in self.calls), 1)
        self.assertNotIn(KEY.encode(), (self.root / "ledger/plan.sqlite").read_bytes())

    def test_interrupted_import_keeps_original_birthday_for_retry(self):
        self.fail_import = True
        with module.ledger(self.root / "ledger") as db, patch.object(module, "call", side_effect=self.worker):
            with self.assertRaises(ValueError):
                module.reconcile(db, self.state, Path("/synthetic/binary"), DIGEST, lambda: KEY)
            self.assertEqual(db.execute("SELECT birthday,account FROM plan").fetchone(), (3499900, None))
        self.fail_import = False
        with module.ledger(self.root / "ledger") as db, patch.object(module, "call", side_effect=self.worker):
            module.reconcile(db, self.state, Path("/synthetic/binary"), DIGEST, lambda: KEY)
        self.assertEqual([p[2] for m, p in self.calls if m == "z_importviewingkey"], [3499900, 3499900])

    def test_wrong_marker_or_enabled_payments_cannot_select_birthday(self):
        for changes in (dict(payments_enabled=True), dict(nostos_sdk_preview_v1=False), dict(observation_scope="all-pools")):
            response = status()
            response.update(changes)
            with self.assertRaises(ValueError):
                module.status_valid(response)

    def test_existing_account_without_saved_birthday_is_not_repurposed(self):
        with module.ledger(self.root / "ledger") as db, patch.object(module, "call", return_value=status(True)):
            with self.assertRaises(ValueError):
                module.reconcile(db, self.state, Path("/synthetic/binary"), DIGEST, lambda: self.fail("must not prompt"))

    def test_key_uses_stdin_not_argv_env_or_stderr(self):
        process = Mock(returncode=0)
        process.communicate.return_value = (b'{"id":1,"result":{}}\n', None)
        with patch.object(module.subprocess, "Popen", return_value=process) as spawn:
            module.call(Path("/binary"), Path("/wallet"), "z_importviewingkey", [KEY, "whenkeyisnew", 1])
            self.assertNotIn(KEY, str(spawn.call_args))
            self.assertIn(KEY.encode(), process.communicate.call_args.args[0])
            self.assertEqual(spawn.call_args.kwargs["stderr"], subprocess.DEVNULL)
        process.communicate.side_effect = subprocess.TimeoutExpired("synthetic", 120)
        with patch.object(module.subprocess, "Popen", return_value=process), self.assertRaises(ValueError):
            module.call(Path("/binary"), Path("/wallet"), "nostos_sync", [])
        process.kill.assert_not_called()

    def test_busy_ledger_and_symlink_are_rejected(self):
        with module.ledger(self.root / "ledger"):
            with self.assertRaises(BlockingIOError), module.ledger(self.root / "ledger"):
                pass
        (self.root / "alias").symlink_to(self.root / "ledger", target_is_directory=True)
        with self.assertRaises(ValueError), module.ledger(self.root / "alias"):
            pass


if __name__ == "__main__":
    unittest.main()
