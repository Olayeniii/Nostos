"""Observer provisioning boundary tests. No services or network operations."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('observer_service',Path(__file__).with_name('install-observer-service.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObserverServiceTests(unittest.TestCase):
    def test_refuses_configuration_that_changes_network_spending_or_rpc_boundary(self):
        config = {'backend':'zaino','consensus':{'network':'main'},
                  'external':{'broadcast':False},
                  'rpc':{'bind':['127.0.0.1:38234'],'async_operation_limit':0},
                  'indexer':{'validator_address':'127.0.0.1:38231',
                             'validator_cookie_path':'/home/ubuntu/nostos/mainnet/node-rpc/.cookie'}}
        observer.validate_config(config)
        for section,key,value in [('consensus','network','test'),('external','broadcast',True),
                                  ('rpc','bind',['0.0.0.0:38234']),('rpc','async_operation_limit',1000),
                                  ('indexer','validator_address','127.0.0.1:18232'),
                                  ('indexer','validator_cookie_path','/wallets/merchant/.cookie')]:
            bad = copy.deepcopy(config);bad[section][key] = value
            with self.subTest(section=section,key=key),self.assertRaises(ValueError):
                observer.validate_config(bad)
