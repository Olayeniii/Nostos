"""Package fixed public build files only, never a wallet or control record."""
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import sys


def package(binary, output, commit):
    binary, output = Path(binary), Path(output)
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('commit')
    machine = platform.machine()
    expected = {'x86_64': 62, 'aarch64': 183}.get(machine)
    header = binary.read_bytes()[:20]
    if (expected is None or len(header) != 20 or header[:6] != b'\x7fELF\x02\x01'
            or int.from_bytes(header[18:20], 'little') != expected):
        raise ValueError('native architecture')
    output.mkdir(mode=0o700, exist_ok=False)
    sources = {'nostos-sdk-worker': binary,
               'control.py': Path(__file__).with_name('control.py'),
               'CONTROL_TEST.md': Path(__file__).with_name('CONTROL_TEST.md')}
    hashes = {}
    for name, source in sources.items():
        target = output / name
        shutil.copyfile(source, target)
        target.chmod(0o700 if name == 'nostos-sdk-worker' else 0o600)
        hashes[name] = hashlib.sha256(target.read_bytes()).hexdigest()
    provenance = {'nostos_commit': commit,
                  'sdk_commit': '987382f67e622915228686e9f956c6a9c9a7514c',
                  'machine': machine, 'libc': platform.libc_ver(), 'sha256': hashes,
                  'network_required': True, 'harness_imports_keys': False,
                  'signing_supported': False, 'sends_supported': False, 'live_proof': False}
    (output / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    (output / 'provenance.json').chmod(0o600)
    return provenance


if __name__ == '__main__':
    print(json.dumps(package(*sys.argv[1:]), sort_keys=True))
