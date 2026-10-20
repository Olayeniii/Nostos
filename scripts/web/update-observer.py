"""Install the reviewed timeout build into the stopped, empty mainnet observer."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import tarfile
import tempfile
import time
import tomllib
import zipfile

ROOT = Path('/home/ubuntu/nostos/mainnet/observer')
UNIT = Path('/etc/systemd/system/nostos-mainnet-observer.service')
REVISION = '7e2dd4b75389f5f7839d9af635153cdc096ac265'
RUN = '39405836573'
ZIP_SHA = '5874a1bafa406db32c6d87a3c077294b5f9d3a475c380868c8c85adc9cddef5a'
ARCHIVE_SHA = '74c29b24eab454a6978ef4f6d271dd42991220b41be7869af07ef199cff31b51'
OLD_SHA = '7d45a730a4d4d1b79e237123b126312086c16f359def3a3c88c66dbba1dc5eee'
NEW_SHA = '95dd8f3519da07b14eddff2048d3a75149fb926c0d78928296c87de824881902'


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace('-','_'),path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def candidate(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 100_000_000:
        raise ValueError('Expected the reviewed bounded ZIP archive.')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ZIP_SHA:
        raise ValueError('ZIP checksum mismatch.')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if sorted(archive.namelist()) != ['SHA256SUMS','nostos-observer-arm64.tar.gz','provenance.json']:
            raise ValueError('Unexpected ZIP contents.')
        if archive.getinfo('nostos-observer-arm64.tar.gz').file_size > 100_000_000:
            raise ValueError('Unexpected inner archive size.')
        inner = archive.read('nostos-observer-arm64.tar.gz')
    if hashlib.sha256(inner).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Inner archive checksum mismatch.')
    with tempfile.TemporaryDirectory() as directory:
        archive_path = Path(directory)/'observer.tar.gz'
        archive_path.write_bytes(inner)
        verify = load(Path(__file__).parents[1]/'observer/verify-artifact.py')
        verify.verify(archive_path,ARCHIVE_SHA,REVISION,RUN)
        with tarfile.open(archive_path,'r:gz') as archive:
            binary = archive.extractfile('zallet-zaino').read()
    if hashlib.sha256(binary).hexdigest() != NEW_SHA:
        raise ValueError('Candidate binary checksum mismatch.')
    return binary


def protected(path):
    mode = path.lstat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o022:
        raise ValueError('Expected protected root-owned observer files.')


def run(archive, apply=False, start=False):
    if os.geteuid() != 0 or (start and not apply):
        raise ValueError('Use sudo; starting also requires --apply.')
    state = subprocess.check_output(['systemctl','show',UNIT.name,
        '--property=ActiveState','--value'],stderr=subprocess.PIPE,text=True,timeout=10).strip()
    if state not in ('inactive','failed'):
        raise ValueError('Observer must already be stopped.')
    setup = load(Path(__file__).with_name('install-observer-service.py'))
    protected(UNIT)
    if UNIT.read_text() != setup.unit_text():
        raise ValueError('Unexpected observer unit; preserve it.')
    protected(ROOT/'zallet.toml')
    setup.validate_config(tomllib.loads((ROOT/'zallet.toml').read_text()))
    with sqlite3.connect((ROOT/'wallet.db').as_uri()+'?mode=ro',uri=True) as db:
        if db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] != 0:
            raise ValueError('Update only before importing merchant keys.')
    installed = ROOT/'zallet-zaino'
    protected(installed)
    current = hashlib.sha256(installed.read_bytes()).hexdigest()
    if current not in (OLD_SHA,NEW_SHA):
        raise ValueError('Unknown installed observer binary; preserve it.')
    binary = candidate(archive)
    relay = load(Path(__file__).with_name('update-hosted-node.py'))
    relay.run(False)
    result = dict(read_only=not apply,eligible=True,artifact_verified=True,
        installed=False,already_current=current==NEW_SHA,broadcast_enabled=False,
        testnet_services_changed=False,wallet_files_replaced=False,sends_requested=0)
    if not apply:
        return result
    # The relay updater preserves its old code and rolls back if restart fails.
    relay_result = relay.run(True)
    if current != NEW_SHA:
        backup = ROOT/('zallet-zaino-before-'+str(time.time_ns()))
        os.link(installed,backup,follow_symlinks=False)
        with tempfile.NamedTemporaryFile(dir=ROOT,delete=False) as file:
            temporary = Path(file.name)
            try:
                file.write(binary)
                file.flush()
                os.fsync(file.fileno())
                os.fchmod(file.fileno(),0o700)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary,installed)
        finally:
            temporary.unlink(missing_ok=True)
    if start:
        subprocess.run(['systemctl','start',UNIT.name],check=True,
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20)
    return dict(result,installed=True,previous_binary_retained=True,
        relay_restarted=relay_result.get('relay_restarted',False),
        start_requested=start,rpc_verified=False,merchant_sync_verified=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive',type=Path)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--start',action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.archive,args.apply,args.start)))
    except Exception:
        print(json.dumps(dict(observer_update_complete=False,sends_requested=0,
            action='Preserve the binary, backups and private logs. Check only the mainnet observer and relay; no testnet service was operated.')))
        raise SystemExit(1) from None
