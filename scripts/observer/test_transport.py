import importlib.util
from pathlib import Path
import tomllib
import unittest

spec = importlib.util.spec_from_file_location('transport',Path(__file__).with_name('prepare-transport.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class LockedTransport(unittest.TestCase):
    def fixture(self):
        manifest = '[patch.crates-io]\n' + '\n'.join(
            'zaino-'+name+' = { git = "https://github.com/zodl-inc/zaino.git", rev = "d2d06bdd" }'
            for name in ('common','fetch','state'))
        lock = 'version = 4\n' + ''.join(
            '[[package]]\nname = "zaino-'+name+'"\nversion = "0.4.0"\n'+transport.SOURCE_LINE
            for name in ('common','fetch','proto','state'))
        lock += '[[package]]\nname = "preserved"\nversion = "1.2.3"\nsource = "registry+fixture"\nchecksum = "unchanged"\n'
        return manifest,lock

    def test_only_exact_zaino_sources_change_without_version_or_checksum_updates(self):
        manifest,lock = self.fixture()
        patched_manifest,patched_lock = transport.local_dependencies(manifest,lock)
        before,after = tomllib.loads(lock),tomllib.loads(patched_lock)
        self.assertEqual(before['package'][-1],after['package'][-1])
        for a,b in zip(before['package'][:4],after['package'][:4]):
            del a['source']
            self.assertEqual(a,b)
        self.assertIn('../../../zaino/packages/zaino-fetch',patched_manifest)

    def test_unknown_manifest_or_lock_sources_fail(self):
        manifest,lock = self.fixture()
        for m,l in [(manifest.replace('d2d06bdd','changed'),lock),
                    (manifest,lock.replace(transport.SOURCE_LINE,'',1))]:
            with self.assertRaises(ValueError): transport.local_dependencies(m,l)
