"""Local deployment configuration and failed-switch recovery tests. No Docker calls."""
import copy
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('nostos_deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def test_git_trust_is_scoped_to_exact_checkout(self):
        repo = Path('/home/ubuntu/nostos/repo')
        self.assertEqual(deploy.git_command(repo, 'archive', 'HEAD'),
                         ['git', '-c', 'safe.directory=/home/ubuntu/nostos/repo', 'archive', 'HEAD'])

    def base(self, repo):
        return {'Config': {'Image': 'node:24-bookworm-slim', 'User': '1001:1001',
                           'Env': ['NOSTOS_EMAIL_API_KEY=placeholder', 'NOSTOS_EMAIL_FROM=accounts@example.com', 'NOSTOS_WEB_TRUSTED_ORIGINS=https://nostos.iyforge.xyz',
                                   'NOSTOS_WEB_TOKEN=private-placeholder',
                                   'NOSTOS_MERCHANT_WALLET_RPC_COOKIE_FILE=/wallet/merchant/.cookie'],
                           'Cmd': ['old-command'], 'WorkingDir': '/app'},
                'HostConfig': {'NetworkMode': 'host',
                               'Binds': [str(repo)+':/app', '/wallet-source:/wallet/merchant:ro'],
                               'RestartPolicy': {'Name': 'no'}},
                'Mounts': [{'Source': str(repo), 'Destination': '/app'}]}

    def test_preserves_private_config_and_runtime_without_mutating_original(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root) / 'repo'
            (repo / 'runtime').mkdir(parents=True)
            base = self.base(repo)
            original = copy.deepcopy(base)
            env = dict(v.split('=', 1) for v in base['Config']['Env'])
            result = deploy.start_config(base, Path(root)/'release', Path(root)/'data', env, 3001)
            self.assertEqual(base, original)
            self.assertIn('NOSTOS_WEB_TOKEN=private-placeholder', result['Env'])
            self.assertIn('/wallet-source:/wallet/merchant:ro', result['HostConfig']['Binds'])
            self.assertIn(str(repo/'runtime')+':/app/runtime', result['HostConfig']['Binds'])
            self.assertIn(str(Path(root)/'release')+':/app:ro', result['HostConfig']['Binds'])
            self.assertEqual(result['Cmd'][-1], '3001')
            self.assertEqual(result['User'], '1001:1001')

    def test_missing_mail_holds_release_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)/'repo'
            (repo/'scripts/web').mkdir(parents=True)
            base = self.base(repo)
            base['Config']['Env'] = [entry for entry in base['Config']['Env'] if not entry.startswith('NOSTOS_EMAIL_')]
            with patch.object(deploy, '__file__', str(repo/'scripts/web/deploy.py')), patch.object(deploy, 'docker', return_value=base) as docker:
                with self.assertRaisesRegex(RuntimeError, 'operator mail configuration'):
                    deploy.run()
            self.assertEqual(docker.call_count,1)
            self.assertFalse((Path(root)/'releases').exists())

    def test_failed_final_health_restores_previous_container(self):
        self.exercise_failed_final_health_restore()

    def test_release_is_traversable_under_restrictive_umask(self):
        previous_umask = os.umask(0o077)
        try:
            self.exercise_failed_final_health_restore()
        finally:
            os.umask(previous_umask)

    def exercise_failed_final_health_restore(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)/'repo'
            (repo/'scripts/web').mkdir(parents=True)
            (repo/'runtime').mkdir()
            (repo/'tracked.txt').write_text('Build source, no runtime data.\n')
            subprocess.run(['git', 'init', '-q', str(repo)], check=True)
            subprocess.run(['git', '-C', str(repo), 'add', 'tracked.txt'], check=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            base = self.base(repo)
            calls = []
            payloads = []
            def fake(method, path, payload=None):
                calls.append((method, path))
                if payload is not None:
                    payloads.append(payload)
                if path == '/containers/nostos-web/json':
                    return base
                if method == 'GET':
                    return {'State': {'Running': False, 'ExitCode': 0}}
                return {'Warnings': []}
            with patch.object(deploy, '__file__', str(repo/'scripts/web/deploy.py')), patch.object(deploy, 'docker', fake), patch.object(deploy, 'healthy', side_effect=[True, False, True]), patch.object(deploy.os, 'chown'), patch('builtins.print'):
                with self.assertRaisesRegex(RuntimeError, 'Previous release restored'):
                    deploy.run()
            build = payloads[0]
            preview_config = next(p for p in payloads if p.get('Cmd', [])[-1:] == ['3001'])
            self.assertIn('NOSTOS_RETENTION_ENABLED=0', preview_config['Env'])
            final_config = next(p for p in payloads if p.get('Cmd', [])[-1:] == ['3000'])
            self.assertNotIn('NOSTOS_RETENTION_ENABLED=0', final_config['Env'])
            self.assertFalse(any('NOSTOS_WEB_TOKEN=' in v for v in build['Env']))
            self.assertFalse(any('wallet' in v for v in build['HostConfig']['Binds']))
            releases = list((Path(root)/'releases').iterdir())
            self.assertEqual(len(releases), 1)
            self.assertEqual(stat.S_IMODE(releases[0].stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE((Path(root)/'product-data').stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((Path(root)/'product-data.key').stat().st_mode), 0o600)
            self.assertTrue((releases[0]/'runtime').is_dir())
            self.assertEqual(calls[-1], ('POST', '/containers/nostos-web/start'))
            self.assertTrue(any('/rename?name=nostos-web' in path and 'nostos-web-before-' in path for _, path in calls))


if __name__ == '__main__':
    unittest.main()
