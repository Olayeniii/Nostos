"""Build an isolated release, health-check it, then switch only nostos-web."""
import copy
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import urllib.error


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(90)
        self.sock.connect('/var/run/docker.sock')


def docker(method, path, payload=None):
    connection = DockerConnection('localhost', timeout=90)
    try:
        connection.request(method, path, json.dumps(payload) if payload is not None else None,
                           {'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read()
        if response.status >= 400:
            try:
                detail = json.loads(data).get('message', '')
            except (json.JSONDecodeError, AttributeError):
                detail = ''
            detail = re.sub(r'\b(?:utest1|u1)[a-z0-9]{20,}\b', '[shielded-address]', detail)
            suffix = ': '+detail[:500] if detail else ''
            raise RuntimeError('Docker operation failed (HTTP %d)%s.' % (response.status, suffix))
        return json.loads(data) if data else None
    finally:
        connection.close()


def healthy(port):
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/sign-up' % port, timeout=1) as r:
                if r.status != 200:
                    continue
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/api/product/me' % port, timeout=1)
            except urllib.error.HTTPError as r:
                # This route opens both product databases before rejecting anonymous access.
                if r.code == 401:
                    return True
        except (OSError, TimeoutError):
            pass
        time.sleep(0.5)
    return False


def start_config(base, release, data, env, port):
    config = copy.deepcopy(base['Config'])
    config['Entrypoint'] = None
    config['Cmd'] = ['node', 'apps/web/node_modules/next/dist/bin/next', 'start',
                     'apps/web', '--hostname', '127.0.0.1', '--port', str(port)]
    config['WorkingDir'] = '/app'
    config['Env'] = [key+'='+value for key, value in env.items()]
    host = copy.deepcopy(base['HostConfig'])
    host['NetworkMode'] = 'host'
    excluded = ('/app', '/nostos-product', '/app/runtime') if env.get('NOSTOS_NETWORK') == 'mainnet' else ('/app', '/nostos-product')
    binds = [v for v in host.get('Binds', []) if v.split(':')[1] not in excluded]
    original_app = next((m['Source'] for m in base['Mounts'] if m['Destination'] == '/app'), None)
    if not original_app:
        raise RuntimeError('Expected /app mount is missing; original left running.')
    # Preserve original runtime evidence/database paths when switching from a repo mount.
    old_runtime = Path(original_app) / 'runtime'
    if env.get('NOSTOS_NETWORK') == 'mainnet':
        binds.append(str(data.parent / 'runtime')+':/app/runtime')
    elif old_runtime.is_dir() and not any(v.split(':')[1] == '/app/runtime' for v in binds):
        binds.append(str(old_runtime)+':/app/runtime')
    binds += [str(release)+':/app:ro', str(data)+':/nostos-product']
    host['Binds'] = binds
    host['RestartPolicy'] = {'Name': 'unless-stopped'}
    config['HostConfig'] = host
    return config


def git_command(repo, *arguments):
    # The operator intentionally deploys this checkout as root. Scope trust to
    # this exact path for each call, never to all repositories or global config.
    return ['git', '-c', 'safe.directory='+str(repo.resolve()), *arguments]


def run(mainnet=False):
    repo = Path(__file__).resolve().parents[2]
    web = 'nostos-mainnet-web' if mainnet else 'nostos-web'
    prefix = 'nostos-mainnet-' if mainnet else 'nostos-'
    live_port, preview_port = (3100, 3101) if mainnet else (3000, 3001)
    base = docker('GET', '/containers/'+web+'/json')
    was_running = base.get('State', {}).get('Running', True)
    if not mainnet and any(v == 'NOSTOS_NETWORK=mainnet' for v in base['Config']['Env']):
        raise RuntimeError('Use the separate mainnet deployer. Original left running.')
    profile_root = repo.parent / 'mainnet' if mainnet else repo.parent
    if base['HostConfig']['NetworkMode'] != 'host':
        raise RuntimeError('Expected host network; original left running.')
    # Fail before building or switching when verification email is unavailable.
    email_env = dict(v.split('=', 1) for v in base['Config']['Env'] if '=' in v)
    email_file = profile_root / 'email.env'
    if email_file.exists():
        mode = email_file.stat()
        if mode.st_uid != 0 or mode.st_mode & 0o077:
            raise RuntimeError('Mail configuration must be root-owned with mode 600. Original left running.')
        for line in email_file.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator and key in ('NOSTOS_EMAIL_API_KEY', 'NOSTOS_EMAIL_FROM'):
                email_env[key] = value
    if not email_env.get('NOSTOS_EMAIL_API_KEY') or not email_env.get('NOSTOS_EMAIL_FROM'):
        raise RuntimeError('Verified merchant email requires operator mail configuration. Run sudo python3 scripts/web/configure-email.py. Original left running.')
    funds_file = profile_root / 'funds.env'
    if funds_file.exists():
        mode = funds_file.stat()
        if mode.st_uid != 0 or mode.st_mode & 0o077:
            raise RuntimeError('Funds configuration must be root-owned with mode 600.')
        allowed = ('NOSTOS_MAINNET_CHAIN_RPC_URL', 'NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE') if mainnet else ('NOSTOS_CHAIN_RPC_URL', 'NOSTOS_CHAIN_RPC_COOKIE_FILE')
        for line in funds_file.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator and (key in allowed or key == 'NOSTOS_REFUND_FEE_BUFFER_ZAT'):
                email_env[key] = value
    revision = subprocess.check_output(git_command(repo, 'rev-parse', 'HEAD'), cwd=repo, text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Invalid source revision.')
    root = profile_root
    root.mkdir(exist_ok=True)
    with open(root / 'deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        suffix = str(int(time.time()))
        release = root / 'releases' / (revision[:12]+'-'+suffix)
        release.mkdir(parents=True, mode=0o755)
        os.chmod(release, 0o755)
        with tempfile.TemporaryFile() as archive:
            subprocess.run(git_command(repo, 'archive', 'HEAD'), cwd=repo, stdout=archive, check=True)
            archive.seek(0)
            with tarfile.open(fileobj=archive) as files:
                # The data filter leaves directory modes to mkdir/umask. Only
                # tracked source extraction needs public read/traverse access.
                previous_umask = os.umask(0o022)
                try:
                    files.extractall(release, filter='data')
                finally:
                    os.umask(previous_umask)
        # Docker cannot create a nested bind mountpoint below a read-only /app
        # mount. Include the empty directory before mounting the release.
        (release / 'runtime').mkdir(exist_ok=True)
        builder = prefix+'build-'+suffix
        # No wallet cookies, application tokens, or databases enter the build container.
        build_config = {'Image': base['Config']['Image'], 'WorkingDir': '/app',
                        'Env': ['NEXT_TELEMETRY_DISABLED=1', 'NODE_OPTIONS=--max-old-space-size=768'],
                        'Cmd': ['sh', '-c', 'node scripts/quality/check-node.mjs && npm install -g pnpm@11.28.7 && pnpm install --frozen-lockfile --store-dir /pnpm-store && pnpm check && pnpm --filter @nostos/web build'],
                        'HostConfig': {'Binds': [str(release)+':/app'], 'Memory': 1610612736}}
        docker('POST', '/containers/create?name='+builder, build_config)
        docker('POST', '/containers/'+builder+'/start')
        print('Building isolated release. The current web container stays running.', flush=True)
        while docker('GET', '/containers/'+builder+'/json')['State']['Running']:
            time.sleep(2)
        state = docker('GET', '/containers/'+builder+'/json')['State']
        if state['ExitCode'] != 0:
            raise RuntimeError('Build failed. Original left running. Check: docker logs --tail 40 '+builder)
        env = dict(v.split('=', 1) for v in base['Config']['Env'] if '=' in v)
        env.update(email_env)
        key_path = root / 'product-data.key'
        saved = key_path.read_text().strip() if key_path.exists() else ''
        existing = env.get('NOSTOS_MAINNET_PRODUCT_DATA_KEY' if mainnet else 'NOSTOS_PRODUCT_DATA_KEY', '')
        if saved and existing and saved != existing:
            raise RuntimeError('Product encryption keys disagree. Original left running.')
        key = saved or existing or secrets.token_hex(32)
        if not re.fullmatch(r'[a-f0-9]{64}', key):
            raise RuntimeError('Invalid product encryption key.')
        if not key_path.exists():
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as file:
                file.write(key+'\n')
        os.chmod(key_path, 0o600)
        user = base['Config']['User']
        if not re.fullmatch(r'\d+:\d+', user):
            raise RuntimeError('Expected numeric web UID:GID. Original left running.')
        uid, gid = map(int, user.split(':'))
        data = root / 'product-data'
        data.mkdir(exist_ok=True, mode=0o700)
        os.chown(data, uid, gid)
        if mainnet:
            runtime = root / 'runtime'
            runtime.mkdir(exist_ok=True, mode=0o700)
            os.chown(runtime, uid, gid)
        env_prefix = 'NOSTOS_MAINNET_' if mainnet else 'NOSTOS_'
        env.update({env_prefix+'PRODUCT_DATA_KEY': key,
                    env_prefix+'PRODUCT_DATABASE_PATH': '/nostos-product/accounts.sqlite',
                    env_prefix+'PRODUCT_CORE_DATABASE_PATH': '/nostos-product/payments.sqlite',
                    'NOSTOS_NETWORK': 'mainnet' if mainnet else 'testnet',
                    'NEXT_TELEMETRY_DISABLED': '1'})
        if not mainnet and 'https://nostos.iyforge.xyz' not in env.get('NOSTOS_WEB_TRUSTED_ORIGINS', '').split(','):
            raise RuntimeError('Trusted HTTPS origin is missing. Original left running.')
        preview = prefix+'check-'+suffix
        preview_env = dict(env, NOSTOS_RETENTION_ENABLED='0')
        created = docker('POST', '/containers/create?name='+preview, start_config(base, release, data, preview_env, preview_port))
        if created.get('Warnings'):
            raise RuntimeError('Container configuration warning. Original left running.')
        docker('POST', '/containers/'+preview+'/start')
        try:
            if not healthy(preview_port):
                raise RuntimeError('Candidate did not become healthy. Original left running. Check: docker logs --tail 40 '+preview)
        finally:
            docker('POST', '/containers/'+preview+'/stop?t=10')
        final = prefix+'release-'+suffix
        ready = docker('POST', '/containers/create?name='+final, start_config(base, release, data, env, live_port))
        if ready.get('Warnings'):
            raise RuntimeError('Final container configuration warning. Original left running.')
        backup = web+'-before-'+suffix
        renamed = switched = False
        try:
            docker('POST', '/containers/'+web+'/stop?t=30')
            docker('POST', '/containers/'+web+'/rename?name='+backup)
            renamed = True
            docker('POST', '/containers/'+final+'/rename?name='+web)
            switched = True
            docker('POST', '/containers/'+web+'/start')
            if not healthy(live_port):
                raise RuntimeError('New release did not become healthy.')
        except Exception as failure:
            if switched:
                docker('POST', '/containers/'+web+'/stop?t=10')
                docker('POST', '/containers/'+web+'/rename?name='+final)
            if renamed:
                docker('POST', '/containers/'+backup+'/rename?name='+web)
            if not was_running:
                raise RuntimeError('Initial deployment failed. Mainnet template remains stopped; testnet is unchanged.') from None
            docker('POST', '/containers/'+web+'/start')
            if not healthy(live_port):
                raise RuntimeError('Deployment failed: %s. Previous release did not become healthy after rollback.' % failure) from None
            raise RuntimeError('Deployment failed: %s. Previous release restored and healthy.' % failure) from None
        print('NOSTOS deployed and healthy: '+revision[:12])
        print('Previous release retained: '+backup)


if __name__ == '__main__':
    try:
        run()
    except (RuntimeError, BlockingIOError) as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit('Deployment interrupted. Check nostos-web status. Private configuration was not printed.') from None
