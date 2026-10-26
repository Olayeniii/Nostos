import importlib.util
import hashlib
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('inspect_refund',Path(__file__).with_name('inspect-failed-refund-export.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
TX='da165bc6333903a4954e2e2b9b297e2b249f5b0c5adf7315616de926b113aa92'
class Export(unittest.TestCase):
 def fixture(self, root, reverse=False, mined=None):
  p=root/'wallet.sqlite3';db=sqlite3.connect(p)
  db.execute('CREATE TABLE transactions(txid BLOB,raw BLOB,expiry_height INTEGER,mined_height INTEGER)')
  raw=struct.pack('<IIIII',0x80000006,0,0,0,3530600)+b'private fixture memo and address'
  tx=bytes.fromhex(TX)
  db.execute('INSERT INTO transactions VALUES(?,?,?,?)',(tx[::-1] if reverse else tx,raw,3530600,mined));db.commit();db.close()
  return p
 def test_reports_fields_without_disclosing_data_or_changing_export(self):
  with tempfile.TemporaryDirectory() as root:
   p=self.fixture(Path(root));before=hashlib.sha256(p.read_bytes()).digest();result=m.inspect(p,TX)
   self.assertEqual(result['serialized_expiry_height'],3530600)
   self.assertTrue(result['expiry_fields_match']);self.assertFalse(result['retry_authorized'])
   self.assertNotIn('private',str(result));self.assertNotIn(TX,str(result))
   self.assertEqual(before,hashlib.sha256(p.read_bytes()).digest())
 def test_reversed_identifier_and_mined_record(self):
  with tempfile.TemporaryDirectory() as root:
   result=m.inspect(self.fixture(Path(root),True,3530590),TX)
   self.assertEqual(result['recorded_mined_height'],3530590);self.assertFalse(result['retry_authorized'])
 def test_missing_transaction_remains_blocked(self):
  with tempfile.TemporaryDirectory() as root:
   result=m.inspect(self.fixture(Path(root)),'a'*64)
   self.assertEqual(result['matching_records'],0);self.assertFalse(result['retry_authorized'])
 def test_exposed_directory_and_symlink_refused(self):
  with tempfile.TemporaryDirectory() as root:
   root=Path(root);p=self.fixture(root);link=root/'link';link.symlink_to(p)
   with self.assertRaises(ValueError):m.inspect(link,TX)
   root.chmod(0o755)
   with self.assertRaises(ValueError):m.inspect(p,TX)
 def test_wal_refused(self):
  with tempfile.TemporaryDirectory() as root:
   p=self.fixture(Path(root));Path(str(p)+'-wal').write_bytes(b'fixture')
   with self.assertRaises(ValueError):m.inspect(p,TX)
if __name__=='__main__':unittest.main()
