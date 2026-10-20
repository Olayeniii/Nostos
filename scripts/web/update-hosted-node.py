"""Apply the reviewed relay compatibility fix without changing credentials or wallets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time

INSTALLED = Path('/usr/local/lib/nostos/hosted-node.py')
SETTINGS = Path('/home/ubuntu/nostos/mainnet/hosted-node.json')
SERVICE = 'nostos-mainnet-rpc-relay.service'


def private_regular(path):
    mode = path.lstat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o077:
        raise ValueError('Expected protected root-owned settings.')


def replace_code(data):
    with tempfile.NamedTemporaryFile(dir=INSTALLED.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
            os.fchmod(file.fileno(), 0o644)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, INSTALLED)
    finally:
        temporary.unlink(missing_ok=True)


def run(apply=False):
    if os.geteuid() != 0:
        raise ValueError('Use sudo for the protected relay checks.')
    private_regular(SETTINGS)
    if json.loads(SETTINGS.read_text()).get('broadcast_enabled') is not False:
        raise ValueError('Relay must remain in read-only mode.')
    mode = INSTALLED.lstat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o022:
        raise ValueError('Expected protected installed relay code.')
    command = subprocess.check_output([
        'systemctl', 'show', SERVICE, '--property=ExecStart', '--value'
    ], text=True, stderr=subprocess.PIPE, timeout=10)
    if str(INSTALLED) not in command or '--serve' not in command:
        raise ValueError('Unexpected relay service command.')
    state = subprocess.run([
        'systemctl', 'show', 'nostos-mainnet-observer.service',
        '--property=ActiveState', '--value'
    ], capture_output=True, text=True, timeout=10).stdout.strip()
    if state in ('active', 'activating', 'deactivating', 'reloading'):
        raise ValueError('Keep the new observer stopped during relay repair.')
    source = Path(__file__).with_name('hosted-node.py').read_bytes()
    compile(source, 'hosted-node.py', 'exec')
    if b'NO_ARGUMENT_READ_METHODS' not in source:
        raise ValueError('Reviewed compatibility fix is missing.')
    previous = INSTALLED.read_bytes()
    result = {'read_only': not apply, 'applied': False,
              'broadcast_enabled': False, 'credentials_changed': False,
              'wallet_services_changed': False, 'sends_requested': 0}
    if previous == source:
        return dict(result, already_current=True)
    if not apply:
        return dict(result, eligible=True)
    backup = INSTALLED.with_name('hosted-node-before-null-' + str(time.time_ns()) + '.py')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as file:
        file.write(previous)
    replace_code(source)
    try:
        subprocess.run(['systemctl', 'restart', SERVICE], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
        subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
    except Exception:
        replace_code(previous)
        subprocess.run(['systemctl', 'restart', SERVICE], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
        raise ValueError('Relay update failed; previous code restored. Check relay state.') from None
    return dict(result, applied=True, previous_code_retained=True,
                relay_restarted=True, code_sha256=hashlib.sha256(source).hexdigest(),
                observer_started=False, runtime_compatibility_verified=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.apply)))
    except Exception:
        print(json.dumps({'relay_update_complete': False,
                          'sends_requested': 0,
                          'action': 'Preserve files and inspect relay state privately. No wallet service was changed.'}))
        raise SystemExit(1) from None
