"""Build a new public web release, preserving mainnet settings, data and routing."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import tarfile

ROOT=Path('/home/ubuntu/nostos-web-review.CEfoZq')
REPO=Path('/home/ubuntu/nostos-arm64-build.4eQ9JP/source')
OLD='nostos-mainnet-ui-770c1fc247ff'
CURRENT_SOURCE='public-ui-770c1fc247ff/source'
IMAGE='sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'


def update(revision):
    if os.getuid()!=1001 or not re.fullmatch(r'[a-f0-9]{40}',revision):
        raise ValueError('Use the ubuntu account and exact reviewed revision.')
    os.umask(0o077)
    h=runpy.run_path(str(ROOT/'commerce-build-dd1471c8cada/source/scripts/web/install-refund-detection-review.py'))
    require,docker=h['require'],h['docker']
    with (ROOT/'commerce-install.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        old=json.loads(docker('inspect',OLD))[0]
        expected={'/app':(str(ROOT/CURRENT_SOURCE),False),'/preview':(str(ROOT/'runtime/data'),True),'/preview-rpc':(str(ROOT/'runtime/rpc'),False)}
        require(old['State']['Running'] and old['Image']==IMAGE and old['Config']['User']=='1001:1001'
            and old['HostConfig']['NetworkMode']=='host' and {m['Destination']:(m['Source'],m['RW']) for m in old['Mounts']}==expected,'Current public release changed.')
        env=dict(v.split('=',1) for v in old['Config']['Env'])
        require(env.get('NOSTOS_NETWORK')=='mainnet' and env.get('NOSTOS_WEB_TRUSTED_ORIGINS')=='https://nostos.iyforge.xyz'
            and env.get('NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN')=='https://nostos.iyforge.xyz','Public mainnet origins differ.')
        require(all('\n' not in v and '\r' not in v for v in env.values()),'Unsupported environment format.')
        new='nostos-mainnet-ui-'+revision[:12]
        require(not docker('ps','-a','--filter','name=^/'+new+'$','--format','{{.ID}}').strip(),'Replacement already exists. Preserve it for inspection.')
        work=ROOT/('public-ui-'+revision[:12]);work.mkdir(mode=0o700)
        source=work/'source';source.mkdir(mode=0o700)
        subprocess.run(['git','-C',str(REPO),'fetch','--depth=1','origin',revision],check=True)
        archive=work/'source.tar'
        subprocess.run(['git','-C',str(REPO),'archive','--format=tar','--output='+str(archive),revision],check=True)
        with tarfile.open(archive) as tree:tree.extractall(source,filter='data')
        for relative in ('node_modules','apps/web/node_modules'):
            subprocess.run(['cp','-a',str(ROOT/CURRENT_SOURCE/relative),str(source/relative)],check=True)
        builder=runpy.run_path(str(source/'scripts/web/build-commerce-review.py'))
        command=builder['web_build_command'](work,source,revision)
        command[-1]=command[-1].replace('node /build-tools/node_modules/pnpm/bin/pnpm.cjs check && ','')
        subprocess.run(command,check=True)
        require((source/'apps/web/.next/BUILD_ID').is_file(),'Web build incomplete.')
        public=runpy.run_path(str(source/'scripts/web/publish-reviewed-mainnet.py'))
        ledger=public['snapshot'](OLD)
        settings=work/'public.env';settings.write_text(''.join(k+'='+v+'\n' for k,v in env.items()))
        stopped=False;attempted=False
        try:
            docker('stop','--time','30',OLD);stopped=True
            attempted=True
            docker('run','-d','--name',new,'--restart','unless-stopped','--network=host','--user','1001:1001',
                '--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--memory=1536m',
                '--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--env-file',str(settings),
                '-v',str(source)+':/app:ro','-v',str(ROOT/'runtime/data')+':/preview',
                '-v',str(ROOT/'runtime/rpc')+':/preview-rpc:ro','-w','/app/apps/web',IMAGE,
                'node','/app/apps/web/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3110')
            public['wait'](public['healthy'])
            public['wait'](lambda:public['healthy'](True))
            require(public['snapshot'](new)==ledger,'Financial records changed during update.')
            print(json.dumps(dict(installed=True,revision=revision,public_network='mainnet',public_http=200,
                account_auth_http=401,existing_data_preserved=True,observer_unchanged=True,routing_unchanged=True,sends_requested=0)),flush=True)
        except BaseException:
            if attempted:
                try:docker('stop','--time','30',new)
                except subprocess.CalledProcessError:pass
            if stopped:
                docker('start',OLD)
                public['wait'](public['healthy'])
                print(json.dumps(dict(installed=False,rollback_healthy=True,sends_requested=0)),flush=True)
            raise


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--revision',required=True)
    update(p.parse_args().revision)
