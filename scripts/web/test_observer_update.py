import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def module():
    spec = importlib.util.spec_from_file_location('observer_update',Path(__file__).with_name('update-observer.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class ObserverUpdate(unittest.TestCase):
    def test_rejects_unreviewed_archive_without_extraction(self):
        m = module()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'wrong.zip'
            path.write_bytes(b'unreviewed')
            with self.assertRaises(ValueError): m.candidate(path)
            self.assertEqual(list(Path(directory).iterdir()),[path])

    def exercise(self, apply=False, state='failed', accounts=0):
        m = module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = root/'nostos-mainnet-observer.service'
            unit.write_text('reviewed fixture')
            (root/'zallet.toml').write_text('[fixture]\nvalue = true\n')
            (root/'zallet-zaino').write_bytes(b'old binary')
            (root/'service.log').write_text('preserve log')
            with sqlite3.connect(root/'wallet.db') as db:
                db.execute('CREATE TABLE accounts (id INTEGER)')
                for i in range(accounts): db.execute('INSERT INTO accounts VALUES (?)',(i,))
            setup = SimpleNamespace(unit_text=lambda:'reviewed fixture',validate_config=Mock())
            relay = SimpleNamespace(run=Mock(return_value={'relay_restarted':True}))
            loader = lambda p: setup if p.name=='install-observer-service.py' else relay
            with patch.object(m,'ROOT',root), patch.object(m,'UNIT',unit), \
                 patch.object(m.os,'geteuid',return_value=0),patch.object(m,'protected'), \
                 patch.object(m,'OLD_SHA',hashlib.sha256(b'old binary').hexdigest()), \
                 patch.object(m,'NEW_SHA',hashlib.sha256(b'new binary').hexdigest()), \
                 patch.object(m,'candidate',return_value=b'new binary'), \
                 patch.object(m,'load',side_effect=loader), \
                 patch.object(m.subprocess,'check_output',return_value=state), \
                 patch.object(m.subprocess,'run') as service:
                if state=='active' or accounts:
                    with self.assertRaises(ValueError): m.run(root/'artifact.zip',apply,apply)
                    relay.run.assert_not_called()
                    service.assert_not_called()
                else:
                    result = m.run(root/'artifact.zip',apply,apply)
                    self.assertEqual(result['installed'],apply)
                    self.assertFalse(result['wallet_files_replaced'])
                    if apply:
                        self.assertEqual((root/'zallet-zaino').read_bytes(),b'new binary')
                        backup = list(root.glob('zallet-zaino-before-*'))
                        self.assertEqual(len(backup),1)
                        self.assertEqual(backup[0].read_bytes(),b'old binary')
                        self.assertEqual(service.call_args.args[0],['systemctl','start',unit.name])
                    else:
                        self.assertEqual((root/'zallet-zaino').read_bytes(),b'old binary')
                        service.assert_not_called()
                        self.assertFalse(list(root.glob('zallet-zaino-before-*')))
                self.assertEqual((root/'service.log').read_text(),'preserve log')

    def test_read_only_check_preserves_binary_and_services(self): self.exercise()
    def test_apply_keeps_prior_binary_and_starts_only_observer(self): self.exercise(True)
    def test_running_observer_is_not_stopped_or_changed(self): self.exercise(True,state='active')
    def test_imported_merchant_account_blocks_update(self): self.exercise(True,accounts=1)
