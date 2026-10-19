import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('observer_build', Path(__file__).with_name('build.py'))
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class IsolatedObserverBuild(unittest.TestCase):
    def test_default_is_read_only_even_when_cargo_is_missing(self):
        with tempfile.TemporaryDirectory() as home:
            result = subprocess.run(['python3', str(Path(__file__).with_name('build.py'))],
                env=dict(os.environ, HOME=home), check=True, capture_output=True, text=True)
            self.assertTrue(json.loads(result.stdout)['read_only'])
            self.assertEqual(list(Path(home).iterdir()), [])

    def test_root_build_refusal_happens_before_directory_creation(self):
        with tempfile.TemporaryDirectory() as home, patch.object(Path, 'home', return_value=Path(home)), patch('sys.argv', ['build.py', '--build']), patch.object(BUILD.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(ValueError, 'without sudo'):
                BUILD.main()
            self.assertEqual(list(Path(home).iterdir()), [])

    def test_preserves_and_rejects_an_existing_noncheckout(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            marker = source / 'preserve.txt'
            marker.write_text('existing work')
            with self.assertRaises(ValueError):
                BUILD.verify_source(source)
            self.assertEqual(marker.read_text(), 'existing work')

    def test_rejects_checkout_with_wrong_pin_before_reading_or_modifying_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)
            (source/'.git').mkdir()
            with patch.object(BUILD, 'run', side_effect=[subprocess.CompletedProcess([],0,stdout='wrong\n'), subprocess.CompletedProcess([],0,stdout=BUILD.SOURCE+'\n')]):
                with self.assertRaises(ValueError):
                    BUILD.verify_source(source)
            self.assertEqual(list(source.iterdir()), [source/'.git'])


if __name__ == '__main__':
    unittest.main()
