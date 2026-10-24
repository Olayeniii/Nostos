"""Private preview preparation boundaries. No live credentials or Docker calls."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("private_review", Path(__file__).with_name("prepare-private-review.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReviewTests(unittest.TestCase):
    def test_only_explicit_preview_settings_and_mail_fields(self):
        result = module.settings(dict(NOSTOS_EMAIL_API_KEY="public-test", NOSTOS_EMAIL_FROM="accounts@example.com"))
        self.assertEqual(result["NOSTOS_MAINNET_WALLET_MODE"], "observer-preview")
        self.assertEqual(result["NOSTOS_WEB_TRUSTED_ORIGINS"], "http://localhost:3108")
        self.assertEqual(result["NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN"], "http://localhost:3108")
        self.assertEqual(result["NOSTOS_MAINNET_PRODUCT_DATABASE_PATH"], "/preview/product.sqlite")
        self.assertFalse(any("MERCHANT_WALLET" in key for key in result))
        self.assertNotIn("NOSTOS_PRODUCT_DATA_KEY", result)
        self.assertNotEqual(result["NOSTOS_MAINNET_PRODUCT_DATA_KEY"], module.settings(dict(NOSTOS_EMAIL_API_KEY="public-test", NOSTOS_EMAIL_FROM="accounts@example.com"))["NOSTOS_MAINNET_PRODUCT_DATA_KEY"])

    def test_missing_mail_or_environment_line_injection_refused(self):
        for mail in ({}, dict(NOSTOS_EMAIL_API_KEY="x\nBAD=1", NOSTOS_EMAIL_FROM="a@example.com"), dict(NOSTOS_EMAIL_API_KEY="public-test", NOSTOS_EMAIL_FROM="a@example.com", NOSTOS_MERCHANT_WALLET_RPC_URL="http://unwanted")):
            with self.assertRaises(ValueError):
                module.settings(mail)

    def test_private_files_refuse_overwrite_symlink_and_exposure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "config"
            module.create_private(path, "public fixture", os.getuid(), os.getgid())
            self.assertEqual(module.protected(path, os.getuid()), "public fixture")
            with self.assertRaises(FileExistsError):
                module.create_private(path, "replacement", os.getuid(), os.getgid())
            alias = root / "alias"
            alias.symlink_to(path)
            with self.assertRaises(ValueError):
                module.protected(alias, os.getuid())
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                module.protected(path, os.getuid())

    def test_binary_import_journal_is_audited_without_text_decoding(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "plan.sqlite"
            path.write_bytes(b"SQLite format 3\0\xff")
            path.chmod(0o600)
            self.assertEqual(module.protected_file(path, os.getuid()), path)

    def test_wrong_revision_fails_before_docker_or_file_creation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            marker = root / "revision.txt"
            marker.write_text("wrong revision")
            marker.chmod(0o600)
            with patch.object(module.os, "geteuid", return_value=0), patch.object(module, "private_directory"), patch.object(module.subprocess, "check_output") as docker:
                with self.assertRaises(ValueError):
                    module.prepare(root, root, 1000, 1000)
                docker.assert_not_called()
                self.assertFalse((root / "runtime").exists())


if __name__ == "__main__":
    unittest.main()
