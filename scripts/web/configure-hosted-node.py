"""Privately probe/configure a hosted mainnet node; never signs or sends."""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

ROOT = Path('/home/ubuntu/nostos/mainnet')
SERVICE = '''[Unit]
Description=NOSTOS mainnet hosted chain RPC relay
Wants=network-online.target
After=network-online.target

[Service]
DynamicUser=yes
ExecStart=/usr/bin/python3 /usr/local/lib/nostos/hosted-node.py --serve
LoadCredential=endpoint.json:/home/ubuntu/nostos/mainnet/hosted-node.json
LoadCredential=rpc.cookie:/home/ubuntu/nostos/mainnet/node-rpc/.cookie
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077

[Install]
WantedBy=multi-user.target
'''


def module():
    spec = importlib.util.spec_from_file_location('hosted_node', Path(__file__).with_name('hosted-node.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write_private(path, value, uid=0, gid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as file:
        os.fchmod(file.fileno(), 0o600)
        os.fchown(file.fileno(), uid, gid)
        file.write(value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true', help='After successful read-only probe, create/start only the new relay')
    args = parser.parse_args()
    if args.install and os.geteuid() != 0:
        raise ValueError('Use sudo to install the separate relay.')
    api = module()
    endpoint = getpass.getpass('Paste hosted Zcash MAINNET JSON-RPC URL (hidden): ').strip()
    client = api.HostedNode(endpoint, broadcast_enabled=False)
    result = api.probe(client)
    print(json.dumps(result), flush=True)
    if not args.install:
        return
    # No changes at all before the probe passes. Never overwrite live credentials.
    service = Path('/etc/systemd/system/nostos-mainnet-rpc-relay.service')
    if service.exists() or (ROOT / 'hosted-node.json').exists() or (ROOT / 'node-rpc').exists():
        raise ValueError('Hosted-node configuration exists; preserve and inspect it privately.')
    base = json.loads(subprocess.check_output(['docker', 'inspect', 'nostos-web'], text=True, stderr=subprocess.PIPE, timeout=10))[0]
    user = base['Config']['User']
    parts = user.split(':')
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        raise ValueError('Expected numeric web UID:GID.')
    uid, gid = map(int, parts)
    ROOT.mkdir(exist_ok=True, mode=0o700)
    node = ROOT / 'node-rpc'
    node.mkdir(mode=0o700)
    os.chown(node, uid, gid)
    write_private(node / '.cookie', '__cookie__:'+secrets.token_hex(32)+'\n', uid, gid)
    write_private(ROOT / 'hosted-node.json', json.dumps({'endpoint': endpoint, 'broadcast_enabled': False})+'\n')
    installed = Path('/usr/local/lib/nostos/hosted-node.py')
    installed.parent.mkdir(exist_ok=True, parents=True, mode=0o755)
    os.chmod(installed.parent, 0o755)
    shutil.copyfile(Path(__file__).with_name('hosted-node.py'), installed)
    os.chown(installed, 0, 0)
    os.chmod(installed, 0o644)
    write_private(service, SERVICE)
    os.chmod(service, 0o644)
    subprocess.run(['systemctl', 'daemon-reload'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
    subprocess.run(['systemctl', 'enable', '--now', 'nostos-mainnet-rpc-relay.service'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
    print(json.dumps({'relay_installed': True, 'listen_loopback_only': True, 'port': 38231,
        'broadcast_enabled': False, 'sends_requested': 0, 'testnet_services_changed': False,
        'next': 'Verify local relay, then provision a separate mainnet merchant wallet. No wallet or web deployment was started.'}))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print(json.dumps({'hosted_node_setup_complete': False, 'sends_requested': 0,
            'action': 'Probe or setup failed. No send was requested. If --install was used, inspect the private configuration before repeating; files/service may have been created.'}))
        raise SystemExit(1) from None
