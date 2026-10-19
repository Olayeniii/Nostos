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
    def account_fixture(self, folder):
        path = Path(folder) / "wallet.sqlite"
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE transactions(txid BLOB, mined_height INTEGER, expiry_height INTEGER)")
        db.execute("CREATE TABLE v_transactions(txid BLOB, account_uuid BLOB, account_balance_delta INTEGER, mined_height INTEGER, expiry_height INTEGER)")
        db.execute("CREATE TABLE v_tx_outputs(txid BLOB, from_account_uuid BLOB, value INTEGER, is_change INTEGER, output_pool INTEGER)")
        for name, known in audit.KNOWN.items():
            value = bytes.fromhex(known)[::-1]
            delta = 2000000 if name == "payment" else -1810000
            db.execute("INSERT INTO transactions VALUES(?,1,100)", (value,))
            db.execute("INSERT INTO v_transactions VALUES(?,?,?,1,100)", (value, b"a" * 16, delta))
        for i in range(8):
            value = bytes([i]) * 32
            db.execute("INSERT INTO transactions VALUES(?,1,100)", (value,))
            db.execute("INSERT INTO v_transactions VALUES(?,?,1,1,100)", (value, b"b" * 16))
        return path, db

    def test_account_scope_excludes_unrelated_accounts_and_hides_identifiers(self):
        with tempfile.TemporaryDirectory() as folder:
            path, db = self.account_fixture(folder)
            db.commit()
            db.close()
            before = path.read_bytes()
            output = audit.inspect_database(path)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(output["transaction_count"], 10)
            scoped = output["matching_account"]
            self.assertTrue(scoped["available"])
            self.assertEqual(scoped["transaction_count"], 2)
            self.assertEqual(scoped["other_transaction_count"], 0)
            self.assertEqual(scoped["nonchange_orchard_family_200000_zat_send_transaction_count"], 0)
            self.assertNotIn("a" * 16, json.dumps(output))

    def test_matching_account_unmined_candidate_is_preserved_without_retry_verdict(self):
        with tempfile.TemporaryDirectory() as folder:
            path, db = self.account_fixture(folder)
            value = b"x" * 32
            db.execute("INSERT INTO transactions VALUES(?,NULL,1000)", (value,))
            db.execute("INSERT INTO v_transactions VALUES(?,?,-210000,NULL,1000)", (value, b"a" * 16))
            db.execute("INSERT INTO v_tx_outputs VALUES(?,?,200000,0,4)", (value, b"a" * 16))
            db.commit()
            db.close()
            output = audit.inspect_database(path)
            scoped = output["matching_account"]
            self.assertEqual(scoped["other_transaction_count"], 1)
            self.assertEqual(scoped["other_unmined_count"], 1)
            self.assertEqual(scoped["nonchange_orchard_family_200000_zat_send_transaction_count"], 1)
            self.assertNotIn(value.hex(), json.dumps(output))

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
