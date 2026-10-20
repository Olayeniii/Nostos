"""Bounded empty-observer runtime diagnostic. Never imports keys or sends funds."""
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time

ROOT = Path('/home/ubuntu/nostos/mainnet/observer')


def safe_errors(text):
    result = []
    for line in text.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*m', '', line)
        if not re.search(r'error|failed|panic|critical|caused by|invalid|missing|unsupported', line, re.I):
            continue
        if re.search(r'authorization|cookie|mnemonic|passphrase|password|uview|age-secret|spending.?key|memo|destination', line, re.I):
            continue
        line = re.sub(r'https?://\S+', '<url>', line)
        line = re.sub(r'(?<![A-Za-z0-9])/[\w./:@%+=~-]+', '<path>', line)
        line = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '<email>', line)
        line = re.sub(r'[A-Za-z0-9_+/=-]{24,}', '<value>', line)
        line = re.sub(r'[^\x20-\x7e]', '', line)
        result.append(line[:500])
    return result[-12:]


def active(unit):
    return subprocess.run(['systemctl','is-active','--quiet',unit],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10).returncode == 0


def run():
    if os.geteuid() != 0:
        raise ValueError('Use sudo.')
    if active('nostos-mainnet-observer.service'):
        raise ValueError('Existing observer must already be stopped.')
    with sqlite3.connect((ROOT/'wallet.db').as_uri()+'?mode=ro', uri=True) as db:
        if db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] != 0:
            raise ValueError('Only an empty observer may be probed.')
    name = 'nostos-observer-probe-'+str(time.time_ns())
    log = ROOT/(name+'.log')
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    properties = [
        'Type=exec','UMask=0077','NoNewPrivileges=yes','ProtectSystem=strict',
        'ProtectHome=read-only','PrivateTmp=yes','MemoryMax=3G',
        'RuntimeMaxSec=75','TimeoutStopSec=10',
        'ReadWritePaths='+str(ROOT),
        'StandardOutput=append:'+str(log),'StandardError=append:'+str(log),
    ]
    command = ['systemd-run','--quiet','--wait','--collect','--unit='+name]
    command += ['--property='+value for value in properties]
    command += [str(ROOT/'zallet-zaino'),'--datadir',str(ROOT),'start']
    try:
        completed = subprocess.run(command, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=105)
    finally:
        # Only the uniquely named diagnostic unit can be stopped here.
        subprocess.run(['systemctl','stop',name], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=15, check=False)
    with log.open('rb') as file:
        file.seek(max(0, log.stat().st_size-262144))
        text = file.read(262144).decode(errors='replace')
    markers = [value for value in (
        'Starting Zaino indexer','Started Zaino indexer','Spawned Zallet tasks',
        'mempool source fetch failed','Waiting for Validator mempool',
        'Chain indexer task exited','Wallet steady-state sync task exited',
        'Wallet recover-history sync task exited','Wallet batch decryptor task exited',
        'Wallet data-requests sync task exited',
    ) if value.lower() in text.lower()]
    supervisor = (completed.stdout+completed.stderr).decode(errors='replace').lower()
    systemd_result = next((value for value in (
        'oom-kill','exit-code','timeout','signal','resources','success'
    ) if 'result: '+value in supervisor), None)
    return {'runtime_probe':True, 'probe_command_exit_code':completed.returncode,
            'systemd_result':systemd_result,
            'diagnostic_service_active':active(name),
            'private_log_bytes':log.stat().st_size, 'markers':markers,
            'filtered_errors':safe_errors(text),
            'merchant_key_imported':False,'sends_requested':0}


if __name__ == '__main__':
    try:
        print(json.dumps(run()))
    except Exception:
        print(json.dumps({'runtime_probe_complete':False,'sends_requested':0,
            'action':'Preserve the observer and private logs. Check that the observer is empty and stopped; no other service was operated.'}))
        raise SystemExit(1) from None
