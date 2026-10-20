"""Offline diagnostic redaction tests. Never start a process or service."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('observer_probe', Path(__file__).with_name('probe-observer-startup.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ObserverProbeTests(unittest.TestCase):
    def test_private_lines_are_dropped_and_public_error_values_are_redacted(self):
        values = ['uview1'+'a'*120, 'AGE-SECRET-KEY-'+'B'*60, 'private-password']
        text = '\n'.join([
            'ERROR viewing key '+values[0],
            'ERROR identity '+values[1],
            'ERROR password '+values[2],
            'ERROR cookie secret-value',
            'ERROR memo private-content',
            'ERROR transport https://provider.example/private-token /private/wallet.db sender@example.com '+ 'c'*64,
            'ERROR missing field `branch_id`',
        ])
        result = '\n'.join(probe.safe_errors(text))
        for value in values+['secret-value','private-content','provider.example','private-token','wallet.db','sender@example.com','c'*64]:
            self.assertNotIn(value,result)
        self.assertIn('missing field `branch_id`',result)

    def test_output_is_bounded_and_non_error_lines_are_omitted(self):
        result = probe.safe_errors('normal startup\n'+'\n'.join('ERROR '+('x '*600) for _ in range(30)))
        self.assertEqual(len(result),12)
        self.assertTrue(all(len(line)<=500 for line in result))
        self.assertNotIn('normal startup','\n'.join(result))
