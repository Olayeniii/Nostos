import importlib.util, tempfile, unittest, json, tarfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('update', Path(__file__).with_name('update-expired-refund-review.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Switch(unittest.TestCase):
 def exercise(self, fail_build=False, fail_health=False):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t); (root/'runtime').mkdir(); calls=[]
   old={'State':{'Running':True},'Image':m.IMAGE,'Config':{'User':'1001:1001'},'HostConfig':{'NetworkMode':'host'},'Mounts':[
    {'Destination':'/app','Source':str(root/'wallet-web-e1aa80f30623/source'),'RW':False},
    {'Destination':'/preview','Source':str(root/'runtime/data'),'RW':True},
    {'Destination':'/preview-rpc','Source':str(root/'runtime/rpc'),'RW':False}]}
   def docker(*args):
    calls.append(args)
    if args[0]=='inspect':return json.dumps([old])
    if args[0]=='exec':return '{"unpaid_requests":1,"saved_refund_routes":1}'
    return ''
   def require(value, message):
    if not value: raise ValueError(message)
   def run(cmd, **kwargs):
    if 'archive' in cmd:
     file=next(x.split('=',1)[1] for x in cmd if x.startswith('--output='))
     with tarfile.open(file,'w'):pass
    if cmd[0]=='fixture-build':
     if fail_build:raise RuntimeError('build')
     p=root/('recovery-web-'+m.REVISION[:12])/'source/apps/web/.next';p.mkdir(parents=True);(p/'BUILD_ID').write_text('fixture')
   def wait(check):
    wait.count+=1
    if fail_health and wait.count==1:raise ValueError('health')
    self.assertTrue(check())
   wait.count=0
   helper={'require':require,'docker':docker,'private':lambda *a,**k:None,'wait_for':wait,
    'http':lambda p:(200,b'{"network":"mainnet","commerceEnabled":true}') if p=='/api/product/network' else (200 if p=='/sign-in' else 401,b'')}
   def load(path):return {'web_build_command':lambda *a:['fixture-build','node /build-tools/node_modules/pnpm/bin/pnpm.cjs check && web']} if str(path).endswith('build-commerce-review.py') else helper
   with patch.object(m,'REVIEW',root),patch.object(m.os,'getuid',return_value=1001),patch.object(m.runpy,'run_path',side_effect=load),patch.object(m.subprocess,'run',side_effect=run):
    if fail_build or fail_health:
     with self.assertRaises((ValueError, RuntimeError)):m.run()
    else:m.run()
   return calls
 def test_success(self):
  calls=self.exercise();self.assertTrue(any(c[0]=='run' for c in calls));self.assertFalse(any(c[0]=='start' for c in calls))
 def test_build_failure_does_not_stop_web(self):
  self.assertFalse(any(c[0]=='stop' for c in self.exercise(fail_build=True)))
 def test_failed_health_restores_old_web(self):
  calls=self.exercise(fail_health=True);self.assertIn(('start',m.OLD),calls);self.assertIn(('stop','--time','30',m.NEW),calls)
unittest.main()
