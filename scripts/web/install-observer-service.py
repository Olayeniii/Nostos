"""Install only the already-prepared, empty observer as a persistent service."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import tomllib

ROOT = Path('/home/ubuntu/nostos/mainnet/observer')
UNIT = Path('/etc/systemd/system/nostos-mainnet-observer.service')
BINARY_SHA = '7d45a730a4d4d1b79e237123b126312086c16f359def3a3c88c66dbba1dc5eee'


def validate_config(config):
    if (config.get('backend') != 'zaino'
            or config.get('consensus',{}).get('network') != 'main'
            or config.get('external',{}).get('broadcast') is not False
            or config.get('rpc',{}).get('bind') != ['127.0.0.1:38234']
            or config.get('rpc',{}).get('async_operation_limit') != 0
            or config.get('indexer',{}).get('validator_address') != '127.0.0.1:38231'
            or config.get('indexer',{}).get('validator_cookie_path') != '/home/ubuntu/nostos/mainnet/node-rpc/.cookie'):
        raise ValueError('Keep the reviewed no-broadcast loopback observer configuration.')


def unit_text():
    return f'''[Unit]
Description=NOSTOS mainnet viewing observer
After=network-online.target nostos-mainnet-rpc-relay.service

[Service]
Type=exec
ExecStart={ROOT}/zallet-zaino --datadir {ROOT} start
WorkingDirectory={ROOT}
Restart=no
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
MemoryMax=3G
LimitCORE=0
ReadWritePaths={ROOT}
ReadOnlyPaths={ROOT}/zallet-zaino {ROOT}/zallet.toml
StandardOutput=append:{ROOT}/service.log
StandardError=append:{ROOT}/service.log

[Install]
WantedBy=multi-user.target
'''


def run(apply=False):
    if os.geteuid() != 0:
        raise ValueError('Use sudo.')
    if UNIT.exists() or UNIT.is_symlink():
        raise ValueError('A persistent unit already exists; preserve it.')
    if subprocess.run(['systemctl','is-active','--quiet',UNIT.name],
                      capture_output=True, timeout=10).returncode == 0:
        raise ValueError('Observer must already be stopped.')
    binary = ROOT/'zallet-zaino'
    mode = binary.lstat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_uid != 0 or mode.st_mode & 0o022:
        raise ValueError('Expected protected installed binary.')
    if hashlib.sha256(binary.read_bytes()).hexdigest() != BINARY_SHA:
        raise ValueError('Unexpected observer binary.')
    validate_config(tomllib.loads((ROOT/'zallet.toml').read_text()))
    with sqlite3.connect((ROOT/'wallet.db').as_uri()+'?mode=ro', uri=True) as db:
        if db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] != 0:
            raise ValueError('Install only before importing merchant keys.')
    result = {'read_only':not apply,'eligible':True,'installed':False,
              'broadcast_enabled':False,'automatic_restart':False,
              'runtime_timeout_configured':False,
              'existing_wallet_services_changed':False,'sends_requested':0}
    if not apply:
        return result
    # Fresh private logging is required; preserve any earlier log instead of replacing it.
    log = ROOT/'service.log'
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    fd = os.open(UNIT, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd,'w') as file:
        os.fchmod(file.fileno(),0o644)
        file.write(unit_text())
    subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True,timeout=15)
    subprocess.run(['systemctl','enable','--now',UNIT.name],check=True,capture_output=True,timeout=20)
    return dict(result,installed=True,start_requested=True,
                private_log_created=True,rpc_verified=False,merchant_sync_verified=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.apply)))
    except Exception:
        print(json.dumps({'observer_service_setup_complete':False,'sends_requested':0,
            'action':'Preserve files and inspect only the observer service privately. No testnet wallet, Zebra or web service was operated.'}))
        raise SystemExit(1) from None
