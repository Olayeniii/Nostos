"""Deployment configuration tests using temporary files only. No Docker or RPC."""
import importlib.util
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MainnetBoundary(unittest.TestCase):
    def settings(self):
        return '\n'.join(['NOSTOS_MAINNET_ENABLED=yes', 'NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL=http://127.0.0.1:38233', 'NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE=/wallet/merchant/.cookie', 'NOSTOS_MAINNET_CHAIN_RPC_URL=http://127.0.0.1:38232', 'NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE=/wallet/node/.cookie', 'NOSTOS_WEB_TRUSTED_ORIGINS=https://mainnet.example', 'NOSTOS_EMAIL_FROM=sender@example.com', 'NOSTOS_EMAIL_API_KEY=fixture'])

    def test_mainnet_settings_reject_testnet_env_and_origin(self):
        module = load('deploy-mainnet')
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'mainnet.env'
            path.write_text(self.settings())
            os.chmod(path, 0o600)
            with patch.object(module.os, 'geteuid', return_value=0):
                # File owner is the test runner, so supply only the UID metadata.
                real_stat = Path.stat
                def metadata(p, *args, **kwargs):
                    result = real_stat(p, *args, **kwargs)
                    values = list(result)
                    values[4] = 0
                    return os.stat_result(values)
                with patch.object(Path, 'stat', metadata):
                    self.assertEqual(module.private_env(path)['NOSTOS_NETWORK'], 'mainnet')
                    for invalid in [self.settings()+'\nNOSTOS_PRODUCT_DATA_KEY=testnet', self.settings().replace('https://mainnet.example', 'https://nostos.iyforge.xyz'), self.settings().replace('ENABLED=yes', 'ENABLED=no'), self.settings().replace('http://127.0.0.1:38233', 'http://user:pass@127.0.0.1:38233')]:
                        path.write_text(invalid)
                        with self.assertRaises(ValueError):
                            module.private_env(path)

    def test_funds_config_rejects_remote_rpc_and_bad_cookie(self):
        module = load('configure-funds')
        module.validate('http://127.0.0.1:18232', '/wallet/node/.cookie', 10000)
        for url,cookie,buffer in [('https://remote.example','/wallet/.cookie',10000), ('http://user:pass@127.0.0.1:18232','/wallet/.cookie',10000), ('http://127.0.0.1:18232','relative',10000), ('http://127.0.0.1:18232','/wallet/.cookie',1)]:
            with self.assertRaises(ValueError):
                module.validate(url,cookie,buffer)

    def test_observer_preview_configuration_requires_no_hosted_signer(self):
        module = load('deploy-mainnet')
        configure = load('configure-mainnet-preview')
        values = configure.settings('https://mainnet.example', {
            'NOSTOS_EMAIL_API_KEY':'fixture', 'NOSTOS_EMAIL_FROM':'sender@example.com',
            'NOSTOS_MERCHANT_WALLET_RPC_URL':'must-not-copy'})
        self.assertNotIn('NOSTOS_MERCHANT_WALLET_RPC_URL', values)
        self.assertFalse(any('MERCHANT_WALLET' in k for k in values))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'mainnet.env'
            path.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
            path.chmod(0o600)
            real_stat = Path.stat
            def metadata(p, *args, **kwargs):
                result = list(real_stat(p, *args, **kwargs)); result[4] = 0
                return os.stat_result(result)
            with patch.object(Path, 'stat', metadata):
                self.assertEqual(module.private_env(path)['NOSTOS_MAINNET_WALLET_MODE'], 'observer-preview')
                for key,value in [('NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL','http://127.0.0.1:38233'),
                                  ('NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE','/wallet/merchant/.cookie'),
                                  ('NOSTOS_MAINNET_OBSERVER_RPC_URL','http://remote.example:38234'),
                                  ('NOSTOS_MAINNET_WALLET_MODE','anything-else')]:
                    bad = dict(values); bad[key] = value
                    path.write_text(''.join(k+'='+v+'\n' for k,v in bad.items()))
                    with self.assertRaises(ValueError): module.private_env(path)

    def test_preview_origin_and_chain_checks_reject_wrong_network_or_tip(self):
        module = load('configure-mainnet-preview')
        for origin in ['http://mainnet.example','https://nostos.iyforge.xyz',
                       'https://mainnet.example/path','https://u:p@mainnet.example',
                       'https://mainnet.example?key=private','https://mainnet.example:8443']:
            with self.assertRaises(ValueError): module.validate_origin(origin)
        chain = {'chain':'main','blocks':100,'bestblockhash':'a'*64}
        self.assertTrue(module.chain_identity(chain, {'node_tip':{'height':100,'blockhash':'a'*64}}))
        self.assertFalse(module.chain_identity(chain, {'node_tip':{'height':100,'blockhash':'b'*64}}))
        self.assertFalse(module.chain_identity(chain, {'node_tip':{'height':99,'blockhash':'a'*64}}))
        with self.assertRaises(ValueError): module.chain_identity(dict(chain,chain='test'), {})

    def test_preview_failure_reports_stage_without_private_exception_text(self):
        import json
        module = load('configure-mainnet-preview')
        module.DIAGNOSTIC.update(stage='observer_rpc',rpc_error_code=-28)
        for error in (RuntimeError('uview1PRIVATE https://provider.example/private-token'),
                      ValueError('uview1PRIVATE'), FileNotFoundError('/private/cookie-token')):
            result = module.failure(error)
            self.assertEqual(result['failed_stage'],'observer_rpc')
            self.assertEqual(result['rpc_error_code'],-28)
            self.assertTrue(result['read_only'])
            text = json.dumps(result)
            for value in ('uview1PRIVATE','provider.example','cookie-token'):
                self.assertNotIn(value,text)
        result = module.failure(ValueError('Expected a protected regular file.'))
        self.assertEqual(result['reason'],'Expected a protected regular file.')

    def test_preview_deployment_mounts_only_rpc_cookies_without_signer_or_wallet_database(self):
        module = load('deploy-mainnet')
        configure = load('configure-mainnet-preview')
        env = configure.settings('https://mainnet.example', {
            'NOSTOS_EMAIL_API_KEY':'fixture', 'NOSTOS_EMAIL_FROM':'sender@example.com'})
        calls = []
        def docker(method,path,payload=None):
            calls.append((method,path,payload))
            if path == '/containers/json?all=1': return []
            if path == '/containers/nostos-web/json':
                return {'Config':{'Image':'node:24-bookworm-slim','User':'1001:1001',
                                  'Env':['NOSTOS_PRODUCT_DATA_KEY=must-not-copy']}}
            return {}
        deploy_calls = []
        fake = SimpleNamespace(docker=docker,run=lambda **kwargs:deploy_calls.append(kwargs))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:None))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('observer-rpc','node-rpc'):
                (root/name).mkdir(); (root/name/'.cookie').write_text('fixture')
            with patch.object(module,'ROOT',root), patch.object(module.os,'geteuid',return_value=0), \
                 patch.object(module,'private_env',return_value=env), \
                 patch.object(module.importlib.util,'spec_from_file_location',return_value=spec), \
                 patch.object(module.importlib.util,'module_from_spec',return_value=fake):
                module.run()
        created = next(payload for method,path,payload in calls if method == 'POST')
        binds = created['HostConfig']['Binds']
        self.assertTrue(any(':/wallet/observer:ro' in value for value in binds))
        self.assertTrue(any(':/wallet/node:ro' in value for value in binds))
        self.assertFalse(any(':/wallet/merchant' in value or value.split(':')[0].endswith('/observer') or '/wallets/' in value.split(':')[0] for value in binds))
        self.assertFalse(any(value.startswith('NOSTOS_PRODUCT_DATA_KEY=') for value in created['Env']))
        self.assertEqual(deploy_calls,[{'mainnet':True}])

    def test_default_deployer_refuses_mainnet_container(self):
        module=load('deploy')
        base={'Config':{'Env':['NOSTOS_NETWORK=mainnet']},'State':{'Running':True}}
        with patch.object(module,'docker',return_value=base):
            with self.assertRaisesRegex(RuntimeError,'separate mainnet'):
                module.run()

    def test_mainnet_deployment_uses_separate_containers_data_and_ports(self):
        module = load('deploy')
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)/'repo'
            (repo/'scripts/web').mkdir(parents=True)
            (repo/'source.txt').write_text('fixture')
            (repo/'runtime').mkdir()
            (repo/'runtime/testnet-evidence.txt').write_text('old fixture')
            subprocess.run(['git','init','-q',str(repo)],check=True)
            subprocess.run(['git','-C',str(repo),'add','.'],check=True)
            subprocess.run(['git','-C',str(repo),'-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-qm','fixture'],check=True)
            base = {'Config':{'Image':'node:24-bookworm-slim','User':'1001:1001','Env':['NOSTOS_EMAIL_API_KEY=fixture','NOSTOS_EMAIL_FROM=sender@example.com','NOSTOS_WEB_TRUSTED_ORIGINS=https://mainnet.example','NOSTOS_MAINNET_ENABLED=yes'],'Cmd':['old']},'HostConfig':{'NetworkMode':'host','Binds':[str(repo)+':/app']},'Mounts':[{'Source':str(repo),'Destination':'/app'}],'State':{'Running':True}}
            calls=[]
            def docker(method,path,payload=None):
                calls.append((method,path,payload))
                if path=='/containers/nostos-mainnet-web/json': return base
                if method=='GET' and '-build-' in path: return {'State':{'Running':False,'ExitCode':0}}
                if '/containers/create?' in path: return {'Id':'fixture'}
                return {}
            with patch.object(module,'__file__',str(repo/'scripts/web/deploy.py')), patch.object(module,'docker',side_effect=docker), patch.object(module,'healthy',return_value=True) as healthy, patch.object(module.os,'chown'):
                module.run(mainnet=True)
            self.assertEqual([c.args[0] for c in healthy.call_args_list],[3101,3100])
            self.assertFalse(any('/containers/nostos-web/' in path or path=='/containers/nostos-web/json' for _,path,_ in calls))
            final=next(payload for _,path,payload in calls if '/containers/create?name=nostos-mainnet-release-' in path)
            env=dict(v.split('=',1) for v in final['Env'])
            self.assertEqual(env['NOSTOS_NETWORK'],'mainnet')
            self.assertIn('NOSTOS_MAINNET_PRODUCT_DATA_KEY',env)
            self.assertNotIn('NOSTOS_PRODUCT_DATA_KEY',env)
            self.assertTrue(any(str(Path(root)/'mainnet/product-data')+':/nostos-product'==b for b in final['HostConfig']['Binds']))

            self.assertFalse(any(str(repo/'runtime')+':/app/runtime'==b for b in final['HostConfig']['Binds']))
            self.assertIn(str(Path(root)/'mainnet/runtime')+':/app/runtime',final['HostConfig']['Binds'])
