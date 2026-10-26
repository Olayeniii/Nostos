import importlib.util,json,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('ui_update',Path(__file__).with_name('update-public-ui.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
REVISION='a'*40
class Update(unittest.TestCase):
 def exercise(self,fail_build=False,fail_health=False):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);calls=[]
   old={'State':{'Running':True},'Image':m.IMAGE,'Config':{'User':'1001:1001','Env':['NOSTOS_NETWORK=mainnet','NOSTOS_WEB_TRUSTED_ORIGINS=https://nostos.iyforge.xyz','NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN=https://nostos.iyforge.xyz','NOSTOS_MAINNET_PRODUCT_DATA_KEY=fixture-key']},'HostConfig':{'NetworkMode':'host'},'Mounts':[
    {'Destination':'/app','Source':str(root/'final-web-b201c4c1205f/source'),'RW':False},{'Destination':'/preview','Source':str(root/'runtime/data'),'RW':True},{'Destination':'/preview-rpc','Source':str(root/'runtime/rpc'),'RW':False}]}
   def docker(*args):
    calls.append(args)
    return json.dumps([old]) if args[0]=='inspect' else ''
   def require(value,message):
    if not value:raise ValueError(message)
   def command(args,**kwargs):
    if 'archive' in args:
     path=next(a.split('=',1)[1] for a in args if a.startswith('--output='))
     with tarfile.open(path,'w'):pass
    if args[0]=='fixture-build':
     if fail_build:raise RuntimeError('build')
     path=root/('public-ui-'+REVISION[:12])/'source/apps/web/.next';path.mkdir(parents=True);(path/'BUILD_ID').write_text('fixture')
   waits=[]
   def wait(check):
    waits.append(True)
    if fail_health and len(waits)==1:raise ValueError('health')
    self.assertTrue(check())
   def load(path):
    if str(path).endswith('build-commerce-review.py'):return {'web_build_command':lambda *a:['fixture-build','node /build-tools/node_modules/pnpm/bin/pnpm.cjs check && web']}
    if str(path).endswith('publish-reviewed-mainnet.py'):return {'snapshot':lambda *a:{'refunds':[{'status':'confirmed'}]},'wait':wait,'healthy':lambda *a:True}
    return {'require':require,'docker':docker}
   with patch.object(m,'ROOT',root),patch.object(m.os,'getuid',return_value=1001),patch.object(m.runpy,'run_path',side_effect=load),patch.object(m.subprocess,'run',side_effect=command):
    if fail_build or fail_health:
     with self.assertRaises((ValueError,RuntimeError)):m.update(REVISION)
    else:m.update(REVISION)
   if not fail_build:
    settings=(root/('public-ui-'+REVISION[:12])/'public.env')
    self.assertIn('NOSTOS_MAINNET_PRODUCT_DATA_KEY=fixture-key',settings.read_text())
    self.assertEqual(settings.stat().st_mode&0o777,0o600)
   return calls
 def test_success_keeps_network_and_data_settings(self):self.exercise()
 def test_build_failure_leaves_live_web_running(self):self.assertFalse(any(c[0]=='stop' for c in self.exercise(fail_build=True)))
 def test_health_failure_restores_previous_public_web(self):self.assertIn(('start',m.OLD),self.exercise(fail_health=True))
unittest.main()
