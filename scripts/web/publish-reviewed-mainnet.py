"""Publish the existing reviewed mainnet release without rebuilding or sending."""
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

REVIEW = Path('/home/ubuntu/nostos-web-review.CEfoZq')
OLD = 'nostos-private-review-final-b201c4c1205f'
NEW = 'nostos-mainnet-public-b201c4c1205f'
SOURCE = REVIEW / 'final-web-b201c4c1205f/source'
CONFIG = Path('/etc/nginx/conf.d/nostos.conf')
ORIGIN = 'https://nostos.iyforge.xyz'
PORT = 3110
IMAGE = 'sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'


def require(value, message):
    if not value:
        raise ValueError(message)


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True, timeout=60, **kwargs).stdout


def docker(*args):
    return run(['docker', *args])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Unexpected HTTP redirect.')


def http(path, public=False):
    base = ORIGIN if public else 'http://127.0.0.1:' + str(PORT)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(base + path, timeout=5) as response:
            return response.status, response.read(65536)
    except urllib.error.HTTPError as error:
        return error.code, b''


def healthy(public=False):
    status, raw = http('/api/product/network', public)
    return (status == 200 and json.loads(raw) == {'network': 'mainnet', 'commerceEnabled': True}
            and http('/sign-in', public)[0] == 200 and http('/api/product/me', public)[0] == 401)


def wait(check):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise ValueError('Mainnet web health did not pass.')


def replacement(text):
    # Refuse unfamiliar config rather than editing another virtual host.
    includes = re.findall(r'(?m)^\s*include\s+([^;]+);', text)
    require(all(p.strip() == '/etc/letsencrypt/options-ssl-nginx.conf' for p in includes), 'Review included nginx configuration before switching.')
    names = re.findall(r'(?m)^\s*server_name\s+([^;]+);', text)
    require(len(names) == 2 and all(n.strip() == 'nostos.iyforge.xyz' for n in names), 'Unexpected nginx hosts.')
    proxies = re.findall(r'(?m)^\s*proxy_pass\s+([^;]+);', text)
    require(proxies == ['http://127.0.0.1:3000'], 'Unexpected nginx upstream. No routing change made.')
    return re.sub(r'(?m)^(\s*proxy_pass\s+)http://127\.0\.0\.1:3000(\s*;)',
                  lambda m: m[1] + 'http://127.0.0.1:' + str(PORT) + m[2], text, count=1)


def replace_config(data, mode):
    fd, name = tempfile.mkstemp(prefix='.nostos-switch-', dir=CONFIG.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, CONFIG)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def snapshot(container):
    # Compare privately; never print records, routes, keys or transaction IDs.
    js = '''import {ProductStore} from "/app/apps/web/src/product-store.ts";
import {coreStore} from "/app/apps/web/src/product-service.ts";
const s=new ProductStore();const c=coreStore(s);
try{console.log(JSON.stringify({checkouts:s.db.prepare("SELECT id,status,payment_txid FROM checkouts ORDER BY id").all(),requests:s.db.prepare("SELECT id,status,approved_zat FROM refund_requests ORDER BY id").all(),refunds:c.withdrawalDatabase().prepare("SELECT id,status,amount_zat,txid FROM refund_events ORDER BY id").all()}));}finally{c.close();s.close();}'''
    return json.loads(docker('exec', container, 'node', '--import', '/app/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', js))


def publish():
    require(os.getuid() == 0, 'Run this reviewed public routing switch with sudo.')
    os.umask(0o077)
    require(CONFIG.resolve() == CONFIG and CONFIG.is_file() and CONFIG.stat().st_uid == 0,
            'Unexpected nginx configuration file.')
    original = CONFIG.read_bytes()
    changed = replacement(original.decode()).encode()
    mode = CONFIG.stat().st_mode & 0o777
    run(['nginx', '-t'])
    old = json.loads(docker('inspect', OLD))[0]
    expected = {'/app': (str(SOURCE), False), '/preview': (str(REVIEW/'runtime/data'), True),
                '/preview-rpc': (str(REVIEW/'runtime/rpc'), False)}
    require(old['State']['Running'] and old['Image'] == IMAGE and old['Config']['User'] == '1001:1001'
            and old['HostConfig']['NetworkMode'] == 'host'
            and {m['Destination']: (m['Source'], m['RW']) for m in old['Mounts']} == expected,
            'Reviewed mainnet container changed.')
    require(json.loads(docker('inspect', 'nostos-web'))[0]['State']['Running'], 'Testnet rollback container is not running.')
    require(not docker('ps', '-a', '--filter', 'name=^/'+NEW+'$', '--format', '{{.ID}}').strip(),
            'Public mainnet container already exists. Inspect it rather than repeating installation.')
    env = dict(item.split('=', 1) for item in old['Config']['Env'])
    require(env.get('NOSTOS_NETWORK') == 'mainnet' and env.get('NOSTOS_MAINNET_COMMERCE_PREVIEW') == 'yes'
            and env.get('NOSTOS_MAINNET_OBSERVER_RECORD_CHECKS') == 'yes', 'Mainnet commerce settings differ.')
    require(not any(k.startswith('NOSTOS_MAINNET_MERCHANT_WALLET_') and v for k,v in env.items()), 'Unexpected signing-wallet settings.')
    require(all('\n' not in v and '\r' not in v for v in env.values()), 'Unsupported environment format.')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', PORT))
    ledger = snapshot(OLD)
    require(any(r['status'] == 'confirmed' for r in ledger['refunds']), 'Expected confirmed refund record missing.')
    work = REVIEW / 'public-mainnet-b201c4c1205f'
    work.mkdir(mode=0o700)
    (work/'nginx-before.conf').write_bytes(original)
    env['NOSTOS_WEB_TRUSTED_ORIGINS'] = ORIGIN
    env['NOSTOS_MAINNET_ACCOUNT_PUBLIC_ORIGIN'] = ORIGIN
    settings = work/'public.env'
    settings.write_text(''.join(k+'='+v+'\n' for k,v in env.items()))
    routed = False
    stopped = False
    created = False
    try:
        docker('run', '-d', '--name', NEW, '--restart', 'unless-stopped', '--network=host', '--user', '1001:1001',
               '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--memory=1536m',
               '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--env-file', str(settings),
               '-v', str(SOURCE)+':/app:ro', '-v', str(REVIEW/'runtime/data')+':/preview',
               '-v', str(REVIEW/'runtime/rpc')+':/preview-rpc:ro', '-w', '/app/apps/web', IMAGE,
               'node', '/app/apps/web/node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(PORT))
        created = True
        wait(healthy)
        require(snapshot(NEW) == ledger, 'Saved financial records changed during startup.')
        # Only this source version owns the mainnet background tasks after switch.
        docker('stop', '--time', '30', OLD)
        stopped = True
        require(CONFIG.read_bytes() == original, 'Nginx configuration changed during preparation.')
        replace_config(changed, mode)
        routed = True
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        wait(lambda: healthy(True))
        require(snapshot(NEW) == ledger, 'Saved financial records changed during switch.')
        require(json.loads(docker('inspect', 'nostos-web'))[0]['State']['Running'], 'Testnet rollback container stopped.')
        print(json.dumps(dict(published=True, public_network='mainnet', public_origin=ORIGIN,
            web_http=200, account_auth_http=401, existing_data_preserved=True,
            testnet_container_preserved=True, observer_unchanged=True, sends_requested=0)), flush=True)
    except BaseException:
        if routed:
            replace_config(original, mode)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
        if created:
            docker('stop', '--time', '30', NEW)
        if stopped:
            docker('start', OLD)
        print(json.dumps(dict(published=False, rollback_requested=True, sends_requested=0)), flush=True)
        raise


if __name__ == '__main__':
    with (REVIEW/'commerce-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publish()
