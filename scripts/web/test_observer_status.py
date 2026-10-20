import importlib.util
from pathlib import Path
import unittest


class ObserverStatus(unittest.TestCase):
    def test_progress_uses_latest_start_and_filters_private_data(self):
        spec = importlib.util.spec_from_file_location('status',Path(__file__).with_name('inspect-observer-status.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.progress('''2026-10-20T19:00:00Z Starting Zaino indexer
2026-10-20T19:01:00Z ERROR old failure
2026-10-20T22:00:00Z Starting Zaino indexer
2026-10-20T22:01:00Z Started Zaino indexer
2026-10-20T22:02:00Z chain_height=Height(3524701) Syncing block height=3524694
2026-10-20T22:03:00Z ERROR Chain RPC unavailable. [getblock:provider_timeout]
2026-10-20T22:03:01Z ERROR memo private-do-not-emit
''')
        self.assertEqual(result['latest_indexed_height'],3524694)
        self.assertEqual(result['sampled_chain_height'],3524701)
        self.assertEqual(result['last_log_time'],'2026-10-20T22:03:01Z')
        self.assertTrue(result['indexer_started'])
        self.assertEqual(len(result['filtered_errors']),1)
        self.assertIn('getblock:provider_timeout',result['filtered_errors'][0])
        self.assertNotIn('private-do-not-emit',str(result))
        self.assertNotIn('old failure',str(result))
