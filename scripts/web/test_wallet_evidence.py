import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("wallet_evidence", Path(__file__).with_name("inspect-wallet-evidence.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class WalletEvidenceTests(unittest.TestCase):
    def test_metadata_scan_never_returns_private_columns_and_preserves_db(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wallet.sqlite"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE transactions(txid BLOB, mined_height INTEGER, expiry_height INTEGER, raw BLOB, memo TEXT)")
            for known in audit.KNOWN.values():
                db.execute("INSERT INTO transactions VALUES(?,1,100,?,?)", (bytes.fromhex(known)[::-1], b"private raw sentinel", "private memo sentinel"))
            db.execute("INSERT INTO transactions VALUES(?,NULL,1000,?,?)", (b"x" * 32, b"private raw sentinel", "private memo sentinel"))
            db.commit()
            db.close()
            before = path.read_bytes()
            output = audit.inspect_database(path)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(output["known_transaction_matches"], {"payment": 1, "confirmed_refund": 1})
            self.assertEqual(output["other_transaction_count"], 1)
            self.assertEqual(output["other_unmined_count"], 1)
            self.assertEqual(output["raw_transaction_record_count"], 3)
            text = json.dumps(output)
            self.assertNotIn("sentinel", text)
            for tx in audit.KNOWN.values():
                self.assertNotIn(tx, text)

    def test_unrecognized_schema_is_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wallet.sqlite"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE unrelated(memo TEXT)")
            db.commit()
            db.close()
            self.assertEqual(audit.inspect_database(path), {"transaction_metadata_available": False})

    def test_missing_database_is_not_created(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "missing.sqlite"
            with self.assertRaises(sqlite3.Error):
                audit.inspect_database(path)
            self.assertFalse(path.exists())

    def test_malformed_ids_are_not_treated_as_known_or_other_transactions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "wallet.sqlite"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE transactions(txid TEXT)")
            db.execute("INSERT INTO transactions VALUES('private malformed value')")
            db.commit()
            db.close()
            output = audit.inspect_database(path)
            self.assertEqual(output["invalid_txid_count"], 1)
            self.assertEqual(output["other_transaction_count"], 0)
            self.assertNotIn("private malformed value", json.dumps(output))


if __name__ == "__main__":
    unittest.main()
