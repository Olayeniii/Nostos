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
    binds = [v for v in host.get('Binds', []) if v.split(':')[1] not in ('/app', '/nostos-product')]
    original_app = next((m['Source'] for m in base['Mounts'] if m['Destination'] == '/app'), None)
    if not original_app:
        raise RuntimeError('Expected /app mount is missing; original left running.')
    # Preserve original runtime evidence/database paths when switching from a repo mount.
    old_runtime = Path(original_app) / 'runtime'
    if old_runtime.is_dir() and not any(v.split(':')[1] == '/app/runtime' for v in binds):
        binds.append(str(old_runtime)+':/app/runtime')
    binds += [str(release)+':/app:ro', str(data)+':/nostos-product']
    host['Binds'] = binds
    host['RestartPolicy'] = {'Name': 'unless-stopped'}
    config['HostConfig'] = host
    return config


def run():
    repo = Path(__file__).resolve().parents[2]
    base = docker('GET', '/containers/nostos-web/json')
    if base['HostConfig']['NetworkMode'] != 'host':
        raise RuntimeError('Expected host network; original left running.')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Invalid source revision.')
    root = repo.parent
    root.mkdir(exist_ok=True)
    with open(root / 'deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        suffix = str(int(time.time()))
        release = root / 'releases' / (revision[:12]+'-'+suffix)
        release.mkdir(parents=True)
        with tempfile.TemporaryFile() as archive:
            subprocess.run(['git', 'archive', 'HEAD'], cwd=repo, stdout=archive, check=True)
            archive.seek(0)
            with tarfile.open(fileobj=archive) as files:
                files.extractall(release, filter='data')
        # Docker cannot create a nested bind mountpoint below a read-only /app
        # mount. Include the empty directory before mounting the release.
        (release / 'runtime').mkdir(exist_ok=True)
        builder = 'nostos-build-'+suffix
        # No wallet cookies, application tokens, or databases enter the build container.
        build_config = {'Image': base['Config']['Image'], 'WorkingDir': '/app',
                        'Env': ['NEXT_TELEMETRY_DISABLED=1', 'NODE_OPTIONS=--max-old-space-size=768'],
                        'Cmd': ['sh', '-c', 'npm install -g pnpm@11.25.0 && pnpm install --frozen-lockfile --store-dir /pnpm-store && pnpm check && pnpm --filter @nostos/web build'],
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
        key_path = root / 'product-data.key'
        saved = key_path.read_text().strip() if key_path.exists() else ''
        existing = env.get('NOSTOS_PRODUCT_DATA_KEY', '')
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
        env.update({'NOSTOS_PRODUCT_DATA_KEY': key,
                    'NOSTOS_PRODUCT_DATABASE_PATH': '/nostos-product/accounts.sqlite',
                    'NOSTOS_PRODUCT_CORE_DATABASE_PATH': '/nostos-product/payments.sqlite',
                    'NEXT_TELEMETRY_DISABLED': '1'})
        if 'https://nostos.iyforge.xyz' not in env.get('NOSTOS_WEB_TRUSTED_ORIGINS', '').split(','):
            raise RuntimeError('Trusted HTTPS origin is missing. Original left running.')
        preview = 'nostos-check-'+suffix
        created = docker('POST', '/containers/create?name='+preview, start_config(base, release, data, env, 3001))
        if created.get('Warnings'):
            raise RuntimeError('Container configuration warning. Original left running.')
        docker('POST', '/containers/'+preview+'/start')
        try:
            if not healthy(3001):
                raise RuntimeError('Candidate did not become healthy. Original left running. Check: docker logs --tail 40 '+preview)
        finally:
            docker('POST', '/containers/'+preview+'/stop?t=10')
        final = 'nostos-release-'+suffix
        ready = docker('POST', '/containers/create?name='+final, start_config(base, release, data, env, 3000))
        if ready.get('Warnings'):
            raise RuntimeError('Final container configuration warning. Original left running.')
        backup = 'nostos-web-before-'+suffix
        renamed = switched = False
        try:
            docker('POST', '/containers/nostos-web/stop?t=30')
            docker('POST', '/containers/nostos-web/rename?name='+backup)
            renamed = True
            docker('POST', '/containers/'+final+'/rename?name=nostos-web')
            switched = True
            docker('POST', '/containers/nostos-web/start')
            if not healthy(3000):
                raise RuntimeError('New release did not become healthy.')
        except Exception as failure:
            if switched:
                docker('POST', '/containers/nostos-web/stop?t=10')
                docker('POST', '/containers/nostos-web/rename?name='+final)
            if renamed:
                docker('POST', '/containers/'+backup+'/rename?name=nostos-web')
            docker('POST', '/containers/nostos-web/start')
            if not healthy(3000):
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
