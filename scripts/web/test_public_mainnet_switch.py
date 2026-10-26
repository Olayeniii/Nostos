import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('publish',Path(__file__).with_name('publish-reviewed-mainnet.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Routing(unittest.TestCase):
 def test_replaces_only_reviewed_upstream(self):
  text='server {\nserver_name nostos.iyforge.xyz;\nreturn 301 https://$host$request_uri;\n}\nserver {\nserver_name nostos.iyforge.xyz;\ninclude /etc/letsencrypt/options-ssl-nginx.conf;\nlocation / {\nproxy_pass http://127.0.0.1:3000;\n}\n}\n'
  changed=m.replacement(text)
  self.assertEqual(changed,text.replace('http://127.0.0.1:3000;','http://127.0.0.1:3110;'))
 def test_refuses_unexpected_or_already_changed_routes(self):
  for text in ['server_name other.example;\nproxy_pass http://127.0.0.1:3000;', 'server_name nostos.iyforge.xyz;\nserver_name nostos.iyforge.xyz;\nproxy_pass http://127.0.0.1:3110;','server_name nostos.iyforge.xyz;\nserver_name nostos.iyforge.xyz;\ninclude /etc/nginx/private-routes.conf;\nproxy_pass http://127.0.0.1:3000;']:
   with self.assertRaises(ValueError):m.replacement(text)


import tempfile,json
from unittest.mock import patch
class Switch(unittest.TestCase):
 def exercise(self,fail_candidate=False,fail_public=False):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);config=root/'nostos.conf'
   original='server {\nserver_name nostos.iyforge.xyz;\n}\nserver {\nserver_name nostos.iyforge.xyz;\nproxy_pass http://127.0.0.1:3000;\n}\n'
   config.write_text(original);source=root/'source';calls=[]
   old={'State':{'Running':True},'Image':m.IMAGE,'Config':{'User':'1001:1001','Env':['NOSTOS_NETWORK=mainnet','NOSTOS_MAINNET_COMMERCE_PREVIEW=yes','NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS=yes','NOSTOS_MAINNET_PRODUCT_DATA_KEY=fixture-key']},'HostConfig':{'NetworkMode':'host'},'Mounts':[
    {'Destination':'/app','Source':str(source),'RW':False},{'Destination':'/preview','Source':str(root/'runtime/data'),'RW':True},{'Destination':'/preview-rpc','Source':str(root/'runtime/rpc'),'RW':False}]}
   def docker(*args):
    calls.append(args)
    if args[:2]==('inspect',m.OLD):return json.dumps([old])
    if args[:2]==('inspect','nostos-web'):return json.dumps([{'State':{'Running':True}}])
    return ''
   def wait(check):
    if not check():raise ValueError('health')
   with patch.object(m,'REVIEW',root),patch.object(m,'SOURCE',source),patch.object(m,'CONFIG',config),patch.object(m,'docker',side_effect=docker),patch.object(m,'run',return_value=''),patch.object(m.os,'getuid',return_value=0),patch.object(m.socket,'socket'),patch.object(m,'snapshot',return_value={'refunds':[{'status':'confirmed'}]}),patch.object(m,'wait',side_effect=wait),patch.object(m,'healthy',side_effect=lambda public=False:not(fail_public if public else fail_candidate)):
    if fail_candidate or fail_public:
     with self.assertRaises(ValueError):m.publish()
    else:m.publish()
   if fail_candidate or fail_public:self.assertEqual(config.read_text(),original)
   else:
    self.assertIn('http://127.0.0.1:3110;',config.read_text())
    env=(root/'public-mainnet-b201c4c1205f/public.env').read_text()
    self.assertIn('NOSTOS_MAINNET_PRODUCT_DATA_KEY=fixture-key',env)
    self.assertIn('NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN=https://nostos.iyforge.xyz',env)
    self.assertEqual((root/'public-mainnet-b201c4c1205f/public.env').stat().st_mode&0o777,0o600)
   self.assertNotIn(('stop','--time','30','nostos-web'),calls)
   return calls
 def test_success_preserves_testnet_and_private_settings(self):self.exercise()
 def test_candidate_failure_keeps_public_route(self):
  calls=self.exercise(fail_candidate=True);self.assertNotIn(('stop','--time','30',m.OLD),calls)
 def test_public_failure_restores_route_and_original_mainnet(self):
  calls=self.exercise(fail_public=True);self.assertIn(('start',m.OLD),calls);self.assertIn(('stop','--time','30',m.NEW),calls)
unittest.main()
