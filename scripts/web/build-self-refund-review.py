"""Build and test the private observer only. Never switch services or send."""
import argparse
import fcntl
import os
from pathlib import Path
import platform
import re
import runpy
import shutil
import subprocess
import tarfile

REVIEW = Path('/home/ubuntu/nostos-web-review.CEfoZq')
NATIVE = Path('/home/ubuntu/nostos-arm64-build.4eQ9JP')
PIN = '987382f67e622915228686e9f956c6a9c9a7514c'


def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def build(revision):
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or platform.machine() != 'aarch64' or os.getuid() != 1001:
        raise ValueError('Expected the Ubuntu ARM64 operator and exact revision.')
    for path in (REVIEW, NATIVE, NATIVE / 'source', NATIVE / 'upstream'):
        if path.resolve() != path or not path.is_dir() or path.stat().st_uid != os.getuid():
            raise ValueError('Unexpected build root.')
    os.umask(0o077)
    with (REVIEW / 'commerce-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        work = REVIEW / ('self-refund-build-' + revision[:12])
        work.mkdir(mode=0o700)
        source = work / 'source'
        source.mkdir(mode=0o700)
        run(['git', '-C', NATIVE / 'source', 'fetch', '--depth=1', 'origin', revision])
        actual = subprocess.check_output(['git', '-C', str(NATIVE / 'source'), 'rev-parse', 'FETCH_HEAD'], text=True).strip()
        if actual != revision:
            raise ValueError('Source revision mismatch.')
        archive = work / 'source.tar'
        run(['git', '-C', NATIVE / 'source', 'archive', '--format=tar', '--output=' + str(archive), revision])
        with tarfile.open(archive) as tree:
            tree.extractall(source, filter='data')
        (work / 'revision.txt').write_text(revision + '\n')
        sdk = work / 'zallet'
        run(['git', 'clone', '--no-hardlinks', '--no-checkout', NATIVE / 'upstream', sdk])
        run(['git', 'checkout', '--detach', PIN], cwd=sdk)
        scripts = source / 'scripts/lightclient'
        modules = sdk / 'zallet-core/examples/nostos_observer'
        modules.mkdir(parents=True)
        for name in ('storage', 'transactions', 'transaction_tests', 'connection'):
            shutil.copyfile(scripts / (name + '.rs'), modules / (name + '.rs'))
        shutil.copyfile(scripts / 'observer.rs', modules / 'mod.rs')
        for old, new in (('worker.rs', 'nostos_sdk_worker.rs'), ('observer_fixture.rs', 'nostos_observer_fixture.rs')):
            shutil.copyfile(scripts / old, modules.parent / new)
        run(['python3', scripts / 'prepare.py', sdk])
        helper = runpy.run_path(str(source / 'scripts/web/build-commerce-review.py'))
        helper['finish_native'](work, source, revision)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    build(parser.parse_args().revision)
