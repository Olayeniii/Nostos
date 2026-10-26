"""Switch only the private preview worker, with a one-transaction test exception."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import runpy
import shlex
import subprocess

REVIEW = Path('/home/ubuntu/nostos-web-review.CEfoZq')
BUILD = REVIEW / 'self-refund-build-bc9c5e0ee7a4'
REVISION = 'bc9c5e0ee7a4524eaa87b9ee1dd0654e9fe80e85'
EXPECTED = '3aa8ab866f4dc423e1b9f7d453482a5b7a373d3ebce57bcf2c61585268a25f37'
OLD = REVIEW / 'commerce-build-dd1471c8cada/nostos-sdk-worker'
OLD_HASH = 'd79ac8367d479565ebc374aa9b7a579520ed5604ba7ceb776280881e028997af'
CONFIG = REVIEW / 'runtime/observer-config-detection-8a14cfaae7b5.json'
TXID = 'def969f82c8a01bd686dc10535bb25dbc11fa287bb8ab94e102ee08abd03d038'
WEB = 'nostos-private-review-recovery-33d9c0463192'
HELPER = REVIEW / 'commerce-build-dd1471c8cada/source/scripts/web/install-refund-detection-review.py'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write(path, data):
    staged = path.with_name(path.name + '.self-refund-next')
    with staged.open('xb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.replace(staged, path)


def observer_healthy():
    # No key, account identifier, address or memo leaves the container.
    js = '''import {ProductStore} from "/app/apps/web/src/product-store.ts";
import {coreStore} from "/app/apps/web/src/product-service.ts";
import {observerWallet} from "/app/apps/web/src/merchant-observer.ts";
const s=new ProductStore(); const c=coreStore(s);
try {const p=c.withdrawalDatabase().prepare("SELECT merchant_id FROM observer_record_instructions WHERE kind='refund'").all();
if(p.length!==1) throw Error();
const v=await observerWallet(p[0].merchant_id).call("getwalletstatus",[]);
if(v.locked!==false || v.account_connected!==true || !Number.isSafeInteger(v.fully_synced_height) || v.fully_synced_height!==v.node_tip?.height || v.fully_synced_height!==v.wallet_tip?.height) throw Error();
console.log("healthy");}finally{c.close();s.close();}'''
    result = subprocess.run(['docker','exec','-i',WEB,'node','--import','/app/node_modules/tsx/dist/loader.mjs','--input-type=module'],
                            input=js, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
    return result.returncode == 0 and result.stdout.strip() == 'healthy'


def install():
    os.umask(0o077)
    if os.getuid() != 1001:
        raise ValueError('Use the existing ubuntu operator without sudo.')
    helper = runpy.run_path(str(HELPER))
    require, private = helper['require'], helper['private']
    for path in (REVIEW, BUILD, REVIEW / 'runtime'):
        private(path, directory=True)
    binary = BUILD / 'nostos-sdk-worker'
    for path in (CONFIG, binary, OLD, BUILD / 'build-result.json'):
        private(path)
    require(digest(binary) == EXPECTED and binary.stat().st_mode & 0o100, 'New worker verification failed.')
    report = json.loads((BUILD / 'build-result.json').read_text())
    require(report.get('revision') == REVISION and report.get('binary_sha256') == EXPECTED and report.get('binary') == str(binary), 'Build report changed.')
    original = CONFIG.read_bytes()
    config = json.loads(original)
    require(config.get('binary') == str(OLD) and config.get('binarySha256') == OLD_HASH and digest(OLD) == OLD_HASH and config.get('port') == 38235,
            'Current private observer configuration changed.')
    require(config.get('root') == '/home/ubuntu/nostos-sdk-isolated.86aLK6/state', 'Unexpected observer state root.')
    web_before = helper['docker']('inspect', WEB)
    require(json.loads(web_before)[0]['State']['Running'], 'Expected private web container is not running.')
    matches = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
            if len(args) == 3 and args[2] == os.fsencode(CONFIG):
                require(proc.stat().st_uid == os.getuid(), 'Unexpected broker owner.')
                matches.append((int(proc.name), Path(os.fsdecode(args[1])), Path(os.readlink(proc / 'exe'))))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    require(len(matches) == 1, 'Expected one private observer broker.')
    pid, launcher, node = matches[0]
    require(launcher.resolve() == launcher and launcher.is_relative_to(REVIEW) and launcher.name == 'run-service.mjs', 'Unexpected broker launcher.')
    require(helper['broker_pid'](launcher, CONFIG) == pid, 'Broker process changed.')
    # Broker deliberately clears inherited environment. This private wrapper sets
    # only the exact transaction exception and execs the already-verified binary.
    wrapper = BUILD / 'one-transaction-worker'
    contents = ('#!/bin/sh\nexport NOSTOS_SELF_REFUND_TEST_TXID=' + shlex.quote(TXID) + '\nexec ' + shlex.quote(str(binary)) + ' "$@"\n').encode()
    if wrapper.exists():
        private(wrapper)
        require(wrapper.read_bytes() == contents, 'Existing test wrapper differs.')
    else:
        with wrapper.open('xb') as out:
            out.write(contents)
        wrapper.chmod(0o700)
    backup = BUILD / 'previous-observer-config.json'
    if backup.exists():
        private(backup)
        require(backup.read_bytes() == original, 'Saved rollback configuration differs.')
    else:
        with backup.open('xb') as out:
            out.write(original)
    updated = dict(config, binary=str(wrapper), binarySha256=digest(wrapper))
    child = None
    stopped = False
    try:
        helper['stop_pid'](pid, launcher, CONFIG)
        stopped = True
        atomic_write(CONFIG, (json.dumps(updated) + '\n').encode())
        child = helper['start_broker'](node, launcher, CONFIG, REVIEW / 'observer-self-refund.log')
        helper['wait_for'](lambda: child.poll() is None and observer_healthy(), seconds=60)
        require(helper['http']('/sign-in')[0] == 200 and helper['http']('/api/product/me')[0] == 401, 'Private web health failed.')
        require(json.loads(helper['docker']('inspect', WEB))[0]['State']['Running'], 'Private web stopped.')
        print(json.dumps(dict(installed=True, worker_verified=True, web_unchanged=True,
            existing_data_preserved=True, self_refund_exception='one_transaction_only', sends_requested=0)), flush=True)
    except Exception:
        if child is not None and child.poll() is None:
            helper['stop_pid'](child.pid, launcher, CONFIG)
        if stopped:
            atomic_write(CONFIG, original)
            previous = helper['start_broker'](node, launcher, CONFIG, REVIEW / 'observer-self-refund-rollback.log')
            helper['wait_for'](lambda: previous.poll() is None and observer_healthy(), seconds=60)
            print(json.dumps(dict(installed=False, rollback_healthy=True, sends_requested=0)), flush=True)
        raise


if __name__ == '__main__':
    with (REVIEW / 'commerce-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        install()
