"""Verify a reviewed CI archive without executing a binary or touching services."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import tarfile

PIN = '987382f67e622915228686e9f956c6a9c9a7514c'
PATCH = '1dd74d482df203c17f38c6aa9bab24a4542ec73e6af867f7cf7ee80a01c13c2b'


def verify(archive, expected_hash, revision, run_id):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_hash) or not re.fullmatch(r'[a-f0-9]{40}', revision) or not str(run_id).isdigit():
        raise ValueError('Reviewed checksum, source revision and run ID required')
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > 300_000_000:
        raise ValueError('Expected a regular bounded archive')
    with archive.open('rb') as file:
        if hashlib.file_digest(file, 'sha256').hexdigest() != expected_hash:
            raise ValueError('Archive checksum mismatch')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if sorted(m.name for m in members) != ['provenance.json', 'zallet-zaino'] or not all(m.isfile() for m in members):
            raise ValueError('Unexpected archive contents')
        binary_info = tar.getmember('zallet-zaino')
        if not 64 <= binary_info.size <= 250_000_000 or tar.getmember('provenance.json').size > 16384:
            raise ValueError('Unexpected artifact size')
        metadata = json.load(tar.extractfile('provenance.json'))
        required = dict(architecture='aarch64', build_os='ubuntu-24.04', source_pin=PIN,
            patch_sha256=PATCH, nostos_revision=revision, workflow_run_id=str(run_id),
            wallet_files_included=False, services_changed=False, sends_requested=0)
        if any(metadata.get(k) != value for k, value in required.items()):
            raise ValueError('Build provenance mismatch')
        if 'transport_patch_sha256' in metadata:
            transport_patch = Path(__file__).with_name('zaino-transport.patch')
            if (metadata.get('transport_source_pin') != 'd2d06bdd6591f3b238a3829b8f1b973ae0ec40be'
                    or metadata['transport_patch_sha256'] != hashlib.sha256(transport_patch.read_bytes()).hexdigest()
                    or metadata.get('transport_policy') != 'chain-reads-35s-other-methods-upstream-default'):
                raise ValueError('Transport provenance mismatch')
        file = tar.extractfile('zallet-zaino')
        header = file.read(64)
        digest = hashlib.sha256(header)
        for chunk in iter(lambda: file.read(1048576), b''):
            digest.update(chunk)
        if header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
            raise ValueError('Binary is not ELF64 AArch64')
        if metadata.get('binary_sha256') != digest.hexdigest() or metadata.get('binary_size_bytes') != binary_info.size:
            raise ValueError('Binary checksum/size mismatch')
        return dict(read_only=True, artifact_verified=True, architecture='aarch64',
            revision=revision, workflow_run_id=str(run_id), binary_sha256=digest.hexdigest(),
            binary_size_bytes=binary_info.size, installed=False, services_changed=False,
            sends_requested=0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.archive, args.sha256, args.revision, args.run_id)))
    except Exception:
        print(json.dumps({'artifact_verified': False, 'installed': False,
            'services_changed': False, 'sends_requested': 0}))
        raise SystemExit(1)
