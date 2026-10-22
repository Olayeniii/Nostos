"""Private operator control ledger. No key import, signing or send operation."""
import contextlib
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import secrets
import sqlite3
import stat
import subprocess
import sys
import uuid
import warnings


class Unresolved(Exception):
    pass


def require(condition):
    if not condition:
        raise Unresolved()


def private_root(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path)
    meta = path.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == os.getuid() and not meta.st_mode & 0o077)
    for parent in path.parents:
        meta = parent.lstat()
        sticky_root = meta.st_uid == 0 and meta.st_mode & stat.S_ISVTX
        require(stat.S_ISDIR(meta.st_mode) and meta.st_uid in (0, os.getuid()))
        require(not meta.st_mode & 0o022 or sticky_root)
    return path


def private_file(path):
    meta = path.lstat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid())
    require(not meta.st_mode & 0o077 and meta.st_nlink == 1)


def audit(root):
    private_root(root)
    for entry in root.iterdir():
        require(entry.name in ('control.sqlite', 'control.sqlite-journal', 'control.lock'))
        private_file(entry)


@contextlib.contextmanager
def ledger(path):
    root = private_root(path)
    audit(root)
    flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW
    lock = os.open(root / 'control.lock', flags, 0o600)
    db = None
    try:
        private_file(root / 'control.lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd = os.open(root / 'control.sqlite', flags, 0o600)
        os.close(fd)
        private_file(root / 'control.sqlite')
        db = sqlite3.connect(root / 'control.sqlite', timeout=0)
        db.execute('PRAGMA journal_mode=DELETE')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('''CREATE TABLE IF NOT EXISTS attempts (
            id TEXT PRIMARY KEY, plan TEXT NOT NULL, txid TEXT UNIQUE,
            state TEXT NOT NULL, proof TEXT)''')
        db.commit()
        audit(root)
        yield db
        audit(root)
    finally:
        if db is not None:
            db.close()
        os.close(lock)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def valid_hex(value, length):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{%d}' % length, value) is not None


def prepare(db, account, recipient):
    require(isinstance(account, str) and str(uuid.UUID(account)) == account)
    require(isinstance(recipient, str) and recipient.startswith('u1') and len(recipient) <= 512)
    require(all(json.loads(row[0])['account'] != account
                for row in db.execute('SELECT plan FROM attempts')))
    plan = {'account': account, 'recipient': recipient,
            'memo': 'nostos:control:' + secrets.token_hex(16),
            'amount_zats': 10000, 'fee_cap_zats': 10000,
            'pool': 'ironwood', 'minimum_confirmations': 3}
    attempt = str(uuid.uuid4())
    with db:
        db.execute('INSERT INTO attempts VALUES (?, ?, NULL, ?, NULL)',
                   (attempt, canonical(plan), 'draft'))
    return attempt, plan


def read(db, attempt):
    require(str(uuid.UUID(attempt)) == attempt)
    row = db.execute('SELECT plan, txid, state, proof FROM attempts WHERE id=?', (attempt,)).fetchone()
    require(row is not None)
    return json.loads(row[0]), row[1], row[2], json.loads(row[3]) if row[3] else None


def bind(db, attempt, txid):
    require(valid_hex(txid, 64))
    _, existing, state, _ = read(db, attempt)
    require(state == 'prepared' or existing == txid)
    require(existing is None or existing == txid)
    with db:
        db.execute("UPDATE attempts SET txid=?, state='unresolved', proof=NULL WHERE id=?", (txid, attempt))


def preflight(db, attempt, call):
    plan, txid, _, _ = read(db, attempt)
    require(txid is None)
    result = call(parameters(plan, None))
    require(result == {'nostos_control_plan_v1': True, 'amount_zats': 10000,
                       'fee_cap_zats': 10000, 'pool': 'ironwood',
                       'minimum_confirmations': 3, 'payments_enabled': False})
    with db:
        db.execute("UPDATE attempts SET state='prepared' WHERE id=?", (attempt,))


def worker_call(binary, digest, root, method, params):
    # The worker still enforces its own wallet paths, lock and file permissions.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    private_root(root)
    binary = Path(binary)
    require(binary.is_absolute() and binary.resolve() == binary and valid_hex(digest, 64))
    meta = binary.lstat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_uid in (0, os.getuid()) and not meta.st_mode & 0o022)
    require(hashlib.sha256(binary.read_bytes()).hexdigest() == digest)
    request = canonical({'id': 1, 'method': method, 'params': params}) + '\n'
    require(len(request.encode()) <= 16384)
    process = subprocess.Popen([str(binary), str(root)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env={'PATH': '/usr/bin:/bin'})
    try:
        output, _ = process.communicate(request.encode(), timeout=180)
    except subprocess.TimeoutExpired:
        # Read-only worker: no replacement/send and no verified state on timeout.
        # Leave its current database operation alone; the writer lock blocks overlap.
        raise Unresolved() from None
    require(process.returncode == 0 and len(output) <= 16384)
    response = json.loads(output)
    require(type(response.get('id')) is int and response['id'] == 1 and 'error' not in response)
    require(isinstance(response.get('result'), dict))
    return response['result']


def parameters(plan, txid):
    return [txid, plan['recipient'], plan['memo'], plan['account']]


def validate_proof(proof, txid):
    require(proof.get('nostos_control_v1') is True and proof.get('payments_enabled') is False)
    require(proof.get('txid') == txid and proof.get('pool') == 'ironwood')
    require(proof.get('exact_output_match') is True and proof.get('owned_spend_match') is True)
    require(type(proof.get('amount_zats')) is int and proof['amount_zats'] == 10000)
    require(type(proof.get('fee_zats')) is int and 0 <= proof['fee_zats'] <= 10000)
    require(type(proof.get('confirmations')) is int and proof['confirmations'] >= 3)
    require(type(proof.get('height')) is int and 0 < proof['height'] <= 0xffffffff)
    require(type(proof.get('output_index')) is int and 0 <= proof['output_index'] <= 0xffffffff)
    require(valid_hex(proof.get('block_hash'), 64))


def verify(db, attempt, call):
    plan, txid, _, _ = read(db, attempt)
    require(txid is not None)
    # Clear an earlier successful status before any new network or worker call.
    with db:
        db.execute("UPDATE attempts SET state='unresolved', proof=NULL WHERE id=?", (attempt,))
    first = call(parameters(plan, txid))
    validate_proof(first, txid)
    # Production call starts a new worker each time, proving a normal wallet reopen.
    second = call(parameters(plan, txid))
    validate_proof(second, txid)
    for field in ('txid', 'pool', 'output_index', 'amount_zats', 'fee_zats', 'height', 'block_hash'):
        require(first[field] == second[field])
    with db:
        db.execute("UPDATE attempts SET state='verified', proof=? WHERE id=?", (canonical(second), attempt))
    return {'nostos_control_v1': True, 'passed': True, 'reopen_verified': True,
            'key_imported': False, 'payments_enabled': False}


def main(args):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    warnings.simplefilter('error', getpass.GetPassWarning)
    require(len(args) >= 2 and sys.stdin.isatty() and sys.stdout.isatty())
    command, root, *rest = args
    with ledger(root) as db:
        if command == 'prepare' and len(rest) == 3:
            wallet, binary, digest = rest
            account = getpass.getpass('Business account UUID (hidden): ')
            recipient = getpass.getpass('Separate account Orchard-only mainnet UA (hidden): ')
            attempt, plan = prepare(db, account, recipient)
            print(canonical({'attempt': attempt, 'prepared': False, 'payments_enabled': False}), flush=True)
            # Persist first. Failure retains this immutable attempt for inspection.
            preflight(db, attempt, lambda params: worker_call(binary, digest, wallet, 'nostos_control', params))
            print(canonical({'attempt': attempt, 'prepared': True, 'payments_enabled': False}))
        elif command == 'preflight' and len(rest) == 4:
            attempt, wallet, binary, digest = rest
            preflight(db, attempt, lambda params: worker_call(binary, digest, wallet, 'nostos_control', params))
            print(canonical({'attempt': attempt, 'prepared': True, 'payments_enabled': False}))
        elif command == 'review' and len(rest) == 1:
            # Deliberate private terminal display only, never redirected output.
            plan, _, state, _ = read(db, rest[0])
            print(canonical({'state': state, 'plan': plan}))
        elif command == 'bind' and len(rest) == 1:
            bind(db, rest[0], getpass.getpass('Existing transaction ID (hidden): '))
            print(canonical({'bound': True, 'passed': False}))
        elif command == 'verify' and len(rest) == 4:
            attempt, wallet, binary, digest = rest
            result = verify(db, attempt, lambda params: worker_call(binary, digest, wallet, 'nostos_control', params))
            print(canonical(result))
        else:
            raise Unresolved()


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (Exception, KeyboardInterrupt):
        # Fixed schema only. No key, receiver, memo, txid or exception text.
        print('{"nostos_control_v1":true,"passed":false,"payments_enabled":false}')
        sys.exit(1)
