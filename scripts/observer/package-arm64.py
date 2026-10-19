"""Package exactly one checked ARM64 ELF, provenance and checksum metadata."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile

PIN = '987382f67e622915228686e9f956c6a9c9a7514c'


def package(binary, output):
    if binary.is_symlink() or not binary.is_file():
        raise ValueError('A regular build binary is required')
    with binary.open('rb') as file:
        header = file.read(64)
        file.seek(0)
        binary_hash = hashlib.file_digest(file, 'sha256').hexdigest()
    if len(header) != 64 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
        raise ValueError('Expected a little-endian ELF64 AArch64 binary')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = {
        'architecture': 'aarch64', 'build_os': 'ubuntu-24.04',
        'source_pin': PIN, 'nostos_revision': os.environ['GITHUB_SHA'],
        'workflow_run_id': os.environ['GITHUB_RUN_ID'],
        'patch_sha256': hashlib.sha256(Path(__file__).with_name('zallet-ufvk.patch').read_bytes()).hexdigest(),
        'binary_sha256': binary_hash, 'binary_size_bytes': binary.stat().st_size,
        'services_changed': False, 'wallet_files_included': False, 'sends_requested': 0,
    }
    (output / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = output / 'nostos-observer-arm64.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        info = tar.gettarinfo(str(binary), arcname='zallet-zaino')
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        info.mode = 0o755
        with binary.open('rb') as file:
            tar.addfile(info, file)
        tar.add(output / 'provenance.json', arcname='provenance.json', recursive=False)
    with archive.open('rb') as file:
        archive_hash = hashlib.file_digest(file, 'sha256').hexdigest()
    (output / 'SHA256SUMS').write_text(archive_hash + '  nostos-observer-arm64.tar.gz\n')
    print(json.dumps(dict(manifest, archive_sha256=archive_hash,
                         archive_size_bytes=archive.stat().st_size)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('binary', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    package(args.binary, args.output)
