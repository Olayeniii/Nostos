"""Prepare exact local Zaino sources without updating dependency versions."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tomllib

PIN = 'd2d06bdd6591f3b238a3829b8f1b973ae0ec40be'
SOURCE = 'packages/zaino-fetch/src/jsonrpsee/connector.rs'
BEFORE = 'd3ad60bfb79e250f10dccbbf0911a61f0e3fe239001472bbfa56954dee505da1'
AFTER = 'a8be461675360de5043099c0b329880d872ac256c57d0d4f993d8ade0f3409f4'
SOURCE_LINE = 'source = "git+https://github.com/zodl-inc/zaino.git?rev=d2d06bdd#'+PIN+'"\n'


def local_dependencies(manifest, lock):
    original = tomllib.loads(lock)
    for name in ('common', 'fetch', 'state'):
        old = 'zaino-'+name+' = { git = "https://github.com/zodl-inc/zaino.git", rev = "d2d06bdd" }'
        new = 'zaino-'+name+' = { path = "../../../zaino/packages/zaino-'+name+'" }'
        if manifest.count(old) != 1:
            raise ValueError('Unexpected pinned Zaino manifest.')
        manifest = manifest.replace(old, new)
    if lock.count(SOURCE_LINE) != 4:
        raise ValueError('Unexpected Zaino lock source count.')
    lock = lock.replace(SOURCE_LINE, '')
    modified = tomllib.loads(lock)
    for package in original['package']:
        if package.get('source') == SOURCE_LINE.split('"')[1]:
            if package['name'] not in ('zaino-common','zaino-fetch','zaino-proto','zaino-state'):
                raise ValueError('Unexpected dependency source.')
            del package['source']
    if original != modified:
        raise ValueError('Dependency versions or checksums changed.')
    return manifest, lock


def prepare(zallet, zaino):
    head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=zaino, text=True).strip()
    source = zaino/SOURCE
    if head != PIN or hashlib.sha256(source.read_bytes()).hexdigest() != BEFORE:
        raise ValueError('Unexpected Zaino source.')
    manifest = zallet/'backends/zaino/Cargo.toml'
    lock = zallet/'backends/zaino/Cargo.lock'
    new_manifest, new_lock = local_dependencies(manifest.read_text(), lock.read_text())
    patch = Path(__file__).with_name('zaino-transport.patch').resolve()
    subprocess.run(['git','apply','--check',str(patch)], cwd=zaino, check=True)
    subprocess.run(['git','apply',str(patch)], cwd=zaino, check=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != AFTER:
        raise ValueError('Transport patch checksum mismatch.')
    manifest.write_text(new_manifest)
    lock.write_text(new_lock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('zallet', type=Path)
    parser.add_argument('zaino', type=Path)
    args = parser.parse_args()
    prepare(args.zallet.resolve(), args.zaino.resolve())
