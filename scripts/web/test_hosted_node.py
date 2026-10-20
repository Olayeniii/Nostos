"""Offline transport/probe and loopback relay tests. Never call a provider or send funds."""
import base64
import contextlib
import copy
import http.client
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('hosted_node', Path(__file__).with_name('hosted-node.py'))
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)
ENDPOINT = 'https://shared.eu-central-1.getblock.io/' + 'a'*32 + '/'
HASH = 'b'*64


class Response:
    status = 200
    def __init__(self, value):
        self.raw = value if isinstance(value, bytes) else json.dumps(value).encode()
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, maximum): return self.raw[:maximum]


class Opener:
    def __init__(self, value): self.value, self.requests = value, []
    def open(self, request, timeout):
        self.requests.append(request)
        if isinstance(self.value, Exception): raise self.value
        return Response(self.value)


class ProbeClient:
    broadcast_enabled = False
    def __init__(self): self.calls, self.missing_ironwood, self.network, self.bad_raw = [], False, 'main', False
    def call(self, method, params=None):
        self.calls.append((method, params))
        values = {'getblockchaininfo': {'chain':self.network,'blocks':100,'bestblockhash':HASH,'upgrades':{'branch':{'status':'active'}}},
                  'getblockhash':HASH, 'getbestblockhash':HASH, 'getblockcount':100, 'getinfo':{},
                  'getblockheader':{}, 'getrawmempool':[], 'getrawtransaction':'aabb',
                  'z_gettreestate':{'hash':HASH,'sapling':{},'orchard':{},'ironwood':{}}, 'z_getsubtreesbyindex':{'subtrees':[]}}
        if method=='getblock': return {'hash':HASH,'height':100,'tx':['c'*64]} if params[1]==1 else ('bad!' if self.bad_raw else 'aabb')
        if method=='z_gettreestate' and self.missing_ironwood: values[method].pop('ironwood')
        return copy.deepcopy(values[method])


class HostedNodeTests(unittest.TestCase):
    def test_transient_chain_reads_retry_but_broadcast_never_repeats(self):
        class SequenceOpener:
            def __init__(self, failures):
                self.failures = list(failures)
                self.timeouts = []
            def open(self, request, timeout):
                self.timeouts.append(timeout)
                result = self.failures.pop(0)
                if isinstance(result, Exception): raise result
                return Response(result)
        opener = SequenceOpener([TimeoutError(), urllib.error.URLError('private'), {'result':123}])
        with patch.object(relay.time,'sleep'):
            self.assertEqual(relay.HostedNode(ENDPOINT,opener=opener).call('getblockcount'),123)
        self.assertEqual(opener.timeouts,[8,8,8])
        opener = SequenceOpener([TimeoutError(), {'result':'must not retry'}])
        with self.assertRaises(relay.HostedNodeError):
            relay.HostedNode(ENDPOINT,True,opener).call('sendrawtransaction',['aabb'])
        self.assertEqual(opener.timeouts,[25])

    def test_read_retries_are_bounded_and_do_not_repeat_permanent_errors(self):
        for error, count in [(TimeoutError(),3),
                             (urllib.error.HTTPError(ENDPOINT,429,'private',{},None),3),
                             (urllib.error.HTTPError(ENDPOINT,401,'private',{},None),1),
                             (RuntimeError('private'),1)]:
            opener = Opener(error)
            with patch.object(relay.time,'sleep'), self.assertRaises(relay.HostedNodeError) as caught:
                relay.HostedNode(ENDPOINT,opener=opener).call('getblockcount')
            self.assertEqual(len(opener.requests),count)
            self.assertNotIn('private',str(caught.exception))

    def test_only_documented_https_provider_origin_is_accepted(self):
        self.assertEqual(relay.validate_endpoint(ENDPOINT),ENDPOINT)
        for value in ['http://shared.eu-central-1.getblock.io/'+'a'*32, 'https://shared.eu-central-1.getblock.io.evil.example/'+'a'*32,
                      'https://user:pass@shared.eu-central-1.getblock.io/'+'a'*32, ENDPOINT+'?token=private', ENDPOINT+'#private',
                      'https://127.0.0.1/'+'a'*32, ENDPOINT+'\n']:
            with self.subTest(url=value), self.assertRaises(relay.HostedNodeError): relay.validate_endpoint(value)

    def test_tls_verification_is_enabled_and_redirects_are_refused(self):
        client=relay.HostedNode(ENDPOINT)
        tls=next(h for h in client.opener.handlers if h.__class__.__name__=='HTTPSHandler')
        self.assertTrue(tls._context.check_hostname)
        with self.assertRaises(relay.HostedNodeError): relay.NoRedirect().redirect_request(None,None,None,None,None,None)

    def test_wallet_methods_and_signed_send_are_blocked_by_default(self):
        opener=Opener({'result':'unused'})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        for method in ['z_sendfromaccount','pczt_sign','z_exportkey','walletpassphrase','sendrawtransaction']:
            with self.assertRaises(relay.HostedNodeError): client.call(method,['aabb'])
        self.assertEqual(opener.requests,[])

    def test_transport_sends_only_chain_request_and_drops_provider_metadata(self):
        opener=Opener({'result':123,'error':None,'internal':'private-provider-metadata'})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        result=client.forward({'method':'getblockcount','params':[],'id':2})
        self.assertEqual(result,{'jsonrpc':'2.0','id':2,'result':123,'error':None})
        self.assertIsNone(opener.requests[0].get_header('Authorization'))
        self.assertEqual(json.loads(opener.requests[0].data)['method'],'getblockcount')

    def test_provider_errors_and_urls_do_not_escape(self):
        for error in [{'error':{'message':ENDPOINT+' private memo'}}, RuntimeError(ENDPOINT+' private')]:
            client=relay.HostedNode(ENDPOINT,opener=Opener(error))
            with self.assertRaises(relay.HostedNodeError) as caught: client.call('getinfo')
            self.assertNotIn(ENDPOINT,str(caught.exception))
            self.assertNotIn('private',str(caught.exception))

    def test_zaino_null_params_are_normalized_only_for_no_argument_reads(self):
        opener=Opener({'result':[],'error':None})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        for method in relay.NO_ARGUMENT_READ_METHODS:
            result=client.forward({'method':method,'params':None,'id':1})
            self.assertEqual(result['result'],[])
            self.assertEqual(json.loads(opener.requests[-1].data)['params'],[])
        self.assertEqual(len(opener.requests),len(relay.NO_ARGUMENT_READ_METHODS))

    def test_null_params_do_not_enable_argument_reads_or_wallet_or_send_methods(self):
        for broadcast in (False,True):
            opener=Opener({'result':'unused'})
            client=relay.HostedNode(ENDPOINT,broadcast_enabled=broadcast,opener=opener)
            for method in ['getblock','getblockhash','getrawtransaction','z_gettreestate',
                           'z_getsubtreesbyindex','getaddressbalance','sendrawtransaction',
                           'z_sendfromaccount','z_importviewingkey']:
                with self.subTest(method=method,broadcast=broadcast):
                    with self.assertRaises(relay.HostedNodeError):
                        client.forward({'method':method,'params':None,'id':1})
            self.assertEqual(opener.requests,[])

    def test_other_non_array_params_remain_blocked_for_no_argument_reads(self):
        opener=Opener({'result':1})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        for params in ({},'private',1,False):
            with self.assertRaises(relay.HostedNodeError):
                client.forward({'method':'getrawmempool','params':params,'id':1})
        self.assertEqual(opener.requests,[])

    def test_batches_and_unknown_request_fields_are_not_forwarded(self):
        opener=Opener({'result':1})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        for request in [[{'method':'getinfo'}],{'method':'getinfo','wallet_key':'private'},{'method':'getinfo','params':{}},{'method':'getinfo','id':[]}]:
            with self.assertRaises(relay.HostedNodeError): client.forward(request)
        self.assertEqual(opener.requests,[])

    def test_response_size_is_bounded(self):
        client=relay.HostedNode(ENDPOINT,opener=Opener(b'x'*(relay.MAX_RESPONSE+1)))
        with self.assertRaises(relay.HostedNodeError): client.call('getinfo')

    def test_explicit_broadcast_mode_accepts_only_one_raw_hex_parameter(self):
        opener=Opener({'result':'d'*64})
        client=relay.HostedNode(ENDPOINT,broadcast_enabled=True,opener=opener)
        for args in [[],['private'],['aab'],['aabb',True]]:
            with self.assertRaises(relay.HostedNodeError): client.call('sendrawtransaction',args)
        self.assertEqual(client.call('sendrawtransaction',['aabb']),'d'*64)
        self.assertEqual(len(opener.requests),1) # Stub only; no network call.

    def test_probe_checks_required_pools_without_creating_or_sending(self):
        client=ProbeClient()
        result=relay.probe(client)
        self.assertTrue(result['chain_rpc_probe_passed'])
        self.assertFalse(result['wallet_sync_verified'])
        self.assertFalse(result['broadcast_verified'])
        self.assertEqual(result['sends_requested'],0)
        self.assertFalse(any(m=='sendrawtransaction' or m.startswith('pczt_') for m,_ in client.calls))
        self.assertEqual([p[0] for m,p in client.calls if m=='z_getsubtreesbyindex'],['sapling','orchard','ironwood'])
        self.assertNotIn(HASH,json.dumps(result))

    def test_probe_refuses_testnet_before_any_followup_calls(self):
        client=ProbeClient();client.network='test'
        with self.assertRaises(relay.HostedNodeError):relay.probe(client)
        self.assertEqual(len(client.calls),1)

    def test_probe_refuses_missing_ironwood_or_bad_raw_blocks(self):
        client=ProbeClient();client.missing_ironwood=True
        with self.assertRaises(relay.HostedNodeError):relay.probe(client)
        client=ProbeClient();client.bad_raw=True
        with self.assertRaises(relay.HostedNodeError):relay.probe(client)

    def test_probe_refuses_send_enabled_client(self):
        client=ProbeClient();client.broadcast_enabled=True
        with self.assertRaises(relay.HostedNodeError):relay.probe(client)
        self.assertEqual(client.calls,[])

    def test_server_refuses_non_loopback_or_missing_auth(self):
        for address,cookie in [(('0.0.0.0',0),'name:fixture'),(('127.0.0.1',0),'')]:
            with self.assertRaises(relay.HostedNodeError):relay.RelayServer(address,None,cookie)

    def test_http_requires_auth_and_rejects_wallet_calls_without_logging(self):
        opener=Opener({'result':100})
        client=relay.HostedNode(ENDPOINT,opener=opener)
        server=relay.RelayServer(('127.0.0.1',0),client,'__cookie__:fixture')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,auth='',origin='',params=None):
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            headers={'Content-Type':'application/json','Authorization':auth}
            if origin: headers['Origin']=origin
            connection.request('POST','/',json.dumps({'id':1,'method':method,'params':params}),headers)
            response=connection.getresponse();result=(response.status,response.read());connection.close();return result
        auth='Basic '+base64.b64encode(b'__cookie__:fixture').decode()
        try:
            output=io.StringIO()
            with contextlib.redirect_stderr(output):
                self.assertEqual(request('getblockcount')[0],403)
                self.assertEqual(request('getblockcount',auth,'https://untrusted.example')[0],403)
                self.assertIn(b'error',request('z_exportkey',auth)[1])
                status,body=request('getblockcount',auth)
                self.assertEqual(status,200)
                self.assertEqual(json.loads(body)['result'],100)
                self.assertEqual(json.loads(request('getblockcount',auth,params=[])[1])['result'],100)
            self.assertEqual(output.getvalue(),'')
            self.assertEqual(len(opener.requests),2)
            self.assertTrue(all(json.loads(r.data)['params']==[] for r in opener.requests))
        finally:
            server.shutdown();server.server_close();thread.join(timeout=3)


if __name__=='__main__': unittest.main()
