"""Deployment configuration tests using temporary files only. No Docker or RPC."""
import importlib.util
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


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
