import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('cargo_audit', Path(__file__).with_name('audit-cargo.py'))
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class AuditCargoTests(unittest.TestCase):
    def lock(self, root):
        path = Path(root) / 'Cargo.lock'
        path.write_text('version = 4\n[[package]]\nname = "public-fixture"\nversion = "1.0.0"\n'
                        'source = "registry+https://github.com/rust-lang/crates.io-index"\n')
        return path

    def test_information_is_visible_and_does_not_hide_an_actual_vulnerability(self):
        with tempfile.TemporaryDirectory() as root:
            lock = self.lock(root)
            def response(endpoint, payload=None):
                if endpoint == 'querybatch':
                    return {'results': [{'vulns': [{'id': 'VULN'}, {'id': 'NOTICE'}]}]}
                return {'summary': endpoint, 'affected': [
                    {'package': {'name': 'public-fixture'}, 'database_specific':
                     {'informational': 'unmaintained' if endpoint.endswith('NOTICE') else None}}]}
            with patch.object(AUDIT, 'request', side_effect=response):
                report = AUDIT.audit([lock, lock])
            self.assertEqual(report['registry_packages_checked'], 1)
            self.assertEqual([v['id'] for v in report['vulnerabilities']], ['VULN'])
            self.assertEqual([v['id'] for v in report['informational_notices']], ['NOTICE'])
            self.assertFalse(report['git_dependencies_reviewed'])

    def test_missing_or_paginated_results_cannot_be_called_clean(self):
        with tempfile.TemporaryDirectory() as root:
            for result in [{'results': []}, {'results': [{'next_page_token': 'more'}]}]:
                with patch.object(AUDIT, 'request', return_value=result), self.assertRaises(ValueError):
                    AUDIT.audit([self.lock(root)])


if __name__ == '__main__':
    unittest.main()
