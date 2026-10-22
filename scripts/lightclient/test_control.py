"""Ledger failure/reopen tests. Native tests cover cryptographic matching."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import uuid

import control


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.account = str(uuid.uuid4())
        self.txid = 'a' * 64

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self, db):
        attempt = control.prepare(db, self.account, 'u1private-fixture-recipient')[0]
        control.preflight(db, attempt, lambda _: self.preflight())
        return attempt

    def preflight(self):
        return {'nostos_control_plan_v1': True, 'amount_zats': 10000,
                'fee_cap_zats': 10000, 'pool': 'ironwood',
                'minimum_confirmations': 3, 'payments_enabled': False}

    def proof(self):
        return {'nostos_control_v1': True, 'payments_enabled': False,
                'txid': self.txid, 'pool': 'ironwood', 'output_index': 1,
                'amount_zats': 10000, 'fee_zats': 10000, 'height': 100,
                'block_hash': 'b' * 64, 'confirmations': 3,
                'exact_output_match': True, 'owned_spend_match': True}

    def test_plan_and_tx_binding_survive_reopen_and_cannot_be_replaced(self):
        with control.ledger(self.root) as db:
            attempt = self.prepare(db)
            before = control.read(db, attempt)[0]
            control.bind(db, attempt, self.txid)
            with self.assertRaises(control.Unresolved):
                self.prepare(db)
            with self.assertRaises(control.Unresolved):
                control.bind(db, attempt, 'c' * 64)
        with control.ledger(self.root) as db:
            plan, txid, state, proof = control.read(db, attempt)
            self.assertEqual(plan, before)
            self.assertEqual(txid, self.txid)
            self.assertEqual(state, 'unresolved')
            self.assertIsNone(proof)
        self.assertEqual((self.root / 'control.sqlite').stat().st_mode & 0o777, 0o600)

    def test_same_transaction_cannot_satisfy_two_attempts(self):
        with control.ledger(self.root) as db:
            first = self.prepare(db)
            second, _ = control.prepare(db, str(uuid.uuid4()), 'u1other-fixture-recipient')
            control.preflight(db, second, lambda _: self.preflight())
            control.bind(db, first, self.txid)
            with self.assertRaises(sqlite3.IntegrityError):
                control.bind(db, second, self.txid)
            self.assertIsNone(control.read(db, second)[1])

    def test_two_fresh_checks_are_required_and_retries_do_not_duplicate_records(self):
        with control.ledger(self.root) as db:
            attempt = self.prepare(db)
            control.bind(db, attempt, self.txid)
            calls = []
            def check(params):
                calls.append(params)
                return self.proof()
            for _ in range(2):
                self.assertTrue(control.verify(db, attempt, check)['reopen_verified'])
            self.assertEqual(len(calls), 4)
            self.assertTrue(all(call == calls[0] for call in calls))
            self.assertEqual(calls[0][0], self.txid)
            self.assertEqual(db.execute('SELECT count(*) FROM attempts').fetchone()[0], 1)

    def test_timeout_or_changed_anchor_invalidates_previous_success(self):
        with control.ledger(self.root) as db:
            attempt = self.prepare(db)
            control.bind(db, attempt, self.txid)
            control.verify(db, attempt, lambda _: self.proof())
            def unavailable(_):
                raise TimeoutError('private fixture text')
            with self.assertRaises(TimeoutError):
                control.verify(db, attempt, unavailable)
            self.assertEqual(control.read(db, attempt)[2:], ('unresolved', None))
            proofs = [self.proof(), {**self.proof(), 'block_hash': 'd' * 64}]
            with self.assertRaises(control.Unresolved):
                control.verify(db, attempt, lambda _: proofs.pop(0))
        with control.ledger(self.root) as db:
            self.assertEqual(control.read(db, attempt)[2:], ('unresolved', None))

    def test_every_evidence_boundary_is_checked(self):
        for name, bad in [('txid', 'c' * 64), ('pool', 'orchard'),
                          ('confirmations', 2), ('confirmations', True),
                          ('fee_zats', 10001), ('fee_zats', -1),
                          ('amount_zats', 9999), ('height', 0),
                          ('output_index', -1), ('block_hash', 'invalid'),
                          ('exact_output_match', False), ('owned_spend_match', False),
                          ('payments_enabled', True), ('nostos_control_v1', False)]:
            with self.subTest(name=name, bad=bad), self.assertRaises(control.Unresolved):
                control.validate_proof({**self.proof(), name: bad}, self.txid)

    def test_private_storage_rejects_symlinks_exposed_files_and_second_writer(self):
        with control.ledger(self.root):
            with self.assertRaises(BlockingIOError):
                with control.ledger(self.root):
                    pass
        (self.root / 'control.sqlite').chmod(0o644)
        with self.assertRaises(control.Unresolved):
            with control.ledger(self.root):
                pass
        (self.root / 'control.sqlite').chmod(0o600)
        os.rename(self.root / 'control.sqlite', self.root / 'elsewhere')
        os.symlink(self.root / 'elsewhere', self.root / 'control.sqlite')
        with self.assertRaises(control.Unresolved):
            with control.ledger(self.root):
                pass

    def test_cli_refuses_piped_private_input_and_prints_only_fixed_failure(self):
        script = Path(control.__file__)
        result = subprocess.run([sys.executable, str(script), 'prepare', str(self.root)],
                                input='private fixture input', capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {'nostos_control_v1': True,
                                                     'passed': False, 'payments_enabled': False})
        self.assertEqual(result.stderr, '')
        self.assertEqual(list(self.root.iterdir()), [])

    def test_failed_preflight_retains_one_draft_and_cannot_bind(self):
        with control.ledger(self.root) as db:
            attempt, original = control.prepare(db, self.account, 'u1private-fixture-recipient')
            with self.assertRaises(control.Unresolved):
                control.preflight(db, attempt, lambda _: {'nostos_control_plan_v1': True})
            with self.assertRaises(control.Unresolved):
                control.bind(db, attempt, self.txid)
            self.assertEqual(control.read(db, attempt)[0], original)
            self.assertEqual(control.read(db, attempt)[2], 'draft')
            control.preflight(db, attempt, lambda _: self.preflight())
            control.bind(db, attempt, self.txid)
            with self.assertRaises(control.Unresolved):
                control.preflight(db, attempt, lambda _: self.preflight())

    def test_worker_uses_private_pipes_and_hash_mismatch_never_starts_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            root.chmod(0o700)
            binary = root / 'worker'
            binary.write_text('#!' + sys.executable + '\n'
                'import json, os, sys\n'
                'from pathlib import Path\n'
                'request=json.loads(sys.stdin.readline())\n'
                'Path(sys.argv[1], "started").write_text("fixture")\n'
                'print("private fixture diagnostic", file=sys.stderr)\n'
                'print(json.dumps({"id":request["id"],"result":'
                '{"method":request["method"],"args":request["params"],'
                '"env_names":sorted(os.environ)}}))\n')
            binary.chmod(0o700)
            digest = hashlib.sha256(binary.read_bytes()).hexdigest()
            with self.assertRaises(control.Unresolved):
                control.worker_call(binary, digest, root, 'z_importviewingkey', ['private-fixture'])
            with self.assertRaises(control.Unresolved):
                control.worker_call(binary, '0' * 64, root, 'nostos_control', ['private-fixture'])
            self.assertFalse((root / 'started').exists())
            result = control.worker_call(binary, digest, root, 'nostos_control', ['private-fixture'])
            self.assertEqual(result['method'], 'nostos_control')
            self.assertEqual(result['args'], ['private-fixture'])
            self.assertNotIn('private-fixture', ' '.join(result['env_names']))


if __name__ == '__main__':
    unittest.main()
