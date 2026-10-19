"""Build an isolated patched Zaino binary. Never installs or starts services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

PIN = '987382f67e622915228686e9f956c6a9c9a7514c'
SOURCE = 'zallet-core/src/components/json_rpc/methods/import_viewing_key.rs'
# SHA-256 of the exact patched source compiled by the observer workflow.
EXPECTED_SOURCE = 'a5df373ea4406af55cc203487a8f5eb2f70c5cac3a2c498428b2f6a96c7b26f2'


def run(args, cwd=None, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None)


def verify_source(source):
    if source.is_symlink() or not (source / '.git').is_dir():
        raise ValueError('Invalid isolated source checkout')
    head = run(['git', 'rev-parse', 'HEAD'], source, True).stdout.strip()
    changed = run(['git', 'diff', 'HEAD', '--name-only'], source, True).stdout.splitlines()
    if head != PIN or changed != [SOURCE] or hashlib.sha256((source / SOURCE).read_bytes()).hexdigest() != EXPECTED_SOURCE:
        raise ValueError('Source mismatch; preserve the directory and inspect it')
    if run(['git', 'ls-files', '--others', '--exclude-standard'], source, True).stdout.strip():
        raise ValueError('Unexpected source files; preserve and inspect')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    args = parser.parse_args()
    patch = Path(__file__).with_name('zallet-ufvk.patch').resolve(strict=True)
    build_root = Path.home() / 'nostos' / 'observer-builds'
    patch_hash = hashlib.sha256(patch.read_bytes()).hexdigest()
    destination = build_root / (PIN[:12] + '-' + patch_hash[:12])
    cargo = shutil.which('cargo')
    git = shutil.which('git')
    free = shutil.disk_usage(Path.home()).free
    if not args.build:
        print(json.dumps({'read_only': True, 'architecture': platform.machine(),
            'cargo_available': bool(cargo), 'git_available': bool(git),
            'free_disk_gib': free // (1024**3), 'isolated_build_directory': str(destination),
            'source_pin': PIN, 'sends_requested': 0}))
        return
    if os.geteuid() == 0:
        raise ValueError('Build as the normal ubuntu user, without sudo')
    if not cargo or not git or free < 12 * 1024**3:
        raise ValueError('Build needs cargo, git and at least 12 GiB free space')
    os.umask(0o077)
    build_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    source = destination / 'source'
    if not destination.exists():
        destination.mkdir(mode=0o700)
        source.mkdir(mode=0o700)
        run(['git', 'init', '-q'], source)
        run(['git', 'fetch', '--depth=1', 'https://github.com/zcash/zallet.git', PIN], source)
        run(['git', 'checkout', '--detach', 'FETCH_HEAD'], source)
        run(['git', 'apply', '--check', str(patch)], source)
        run(['git', 'apply', str(patch)], source)
    verify_source(source)
    target = destination / 'target'
    env = dict(os.environ, CARGO_TARGET_DIR=str(target), CARGO_BUILD_JOBS='2')
    subprocess.run([cargo, 'build', '--locked', '--release', '--manifest-path',
        str(source / 'backends/zaino/Cargo.toml')], cwd=source, env=env, check=True)
    verify_source(source)
    binary = target / 'release/zallet-zaino'
    with binary.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    print(json.dumps({'observer_binary_built': True, 'binary': str(binary),
        'binary_sha256': digest, 'source_pin': PIN,
        'services_changed': False, 'installed': False,
        'wallet_initialized': False, 'sends_requested': 0}))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print(json.dumps({'observer_binary_built': False, 'services_changed': False,
            'sends_requested': 0, 'next': 'Build stopped. Preserve the isolated directory and inspect the error; no installed wallet or service was changed.'}))
        raise SystemExit(1)
