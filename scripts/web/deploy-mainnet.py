"""Separate mainnet web deployment. Never starts or changes wallet/node services."""
import importlib.util
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/home/ubuntu/nostos/mainnet')


def private_env(path):
    mode = path.stat()
    if not path.is_file() or path.is_symlink() or mode.st_uid != 0 or mode.st_mode & 0o077:
        raise ValueError('Mainnet settings must be root-owned with mode 600.')
    result = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not value or key in result or not (key.startswith('NOSTOS_MAINNET_') or key in ('NOSTOS_EMAIL_API_KEY', 'NOSTOS_EMAIL_FROM', 'NOSTOS_WEB_TRUSTED_ORIGINS')):
            raise ValueError('Invalid mainnet settings.')
        result[key] = value
    if result.get('NOSTOS_MAINNET_ENABLED') != 'yes':
        raise ValueError('Explicit mainnet enablement is required.')
    origins = result.get('NOSTOS_WEB_TRUSTED_ORIGINS', '').split(',')
    origin = urlsplit(origins[0])
    if len(origins) != 1 or origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment or origin.path or origins[0] == 'https://nostos.iyforge.xyz':
        raise ValueError('Use a separate exact HTTPS mainnet origin.')
    expected = {'NOSTOS_MAINNET_MERCHANT_WALLET_RPC_COOKIE_FILE': '/wallet/merchant/.cookie', 'NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE': '/wallet/node/.cookie'}
    for key, value in expected.items():
        if result.get(key) != value:
            raise ValueError('Use the separate mainnet cookie mounts.')
    for key in ('NOSTOS_MAINNET_MERCHANT_WALLET_RPC_URL', 'NOSTOS_MAINNET_CHAIN_RPC_URL'):
        url = urlsplit(result.get(key, ''))
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.query or url.fragment:
            raise ValueError('Mainnet RPC must be on loopback without URL credentials.')
    if not result.get('NOSTOS_EMAIL_FROM') or not result.get('NOSTOS_EMAIL_API_KEY'):
        raise ValueError('Verified mail configuration is required before deployment.')
    result['NOSTOS_NETWORK'] = 'mainnet'
    return result


def run():
    if os.geteuid() != 0:
        raise ValueError('Run with sudo.')
    spec = importlib.util.spec_from_file_location('nostos_deploy', Path(__file__).with_name('deploy.py'))
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
    env = private_env(ROOT / 'mainnet.env')
    # Mainnet cookie files must already exist. Never create wallets or copy keys.
    for directory in ('wallet-rpc', 'node-rpc'):
        path = ROOT / directory / '.cookie'
        if not path.is_file() or path.is_symlink():
            raise ValueError('Separate mainnet RPC cookies must already be provisioned.')
    names = deploy.docker('GET', '/containers/json?all=1')
    exists = any('/nostos-mainnet-web' in row.get('Names', []) for row in names)
    if not exists:
        template = deploy.docker('GET', '/containers/nostos-web/json')
        # Copy only the Node image/user, never testnet env or credential mounts.
        config = {'Image': template['Config']['Image'], 'User': template['Config']['User'], 'WorkingDir': '/app',
                  'Cmd': ['node', '--version'], 'Env': [k+'='+v for k, v in env.items()],
                  'HostConfig': {'NetworkMode': 'host', 'Binds': [str(Path(__file__).resolve().parents[2])+':/app:ro', str(ROOT/'wallet-rpc')+':/wallet/merchant:ro', str(ROOT/'node-rpc')+':/wallet/node:ro']}}
        deploy.docker('POST', '/containers/create?name=nostos-mainnet-web', config)
    else:
        current = deploy.docker('GET', '/containers/nostos-mainnet-web/json')
        current_env = dict(v.split('=', 1) for v in current['Config']['Env'] if '=' in v)
        # Do not silently leave a newly edited network or origin out of a redeploy.
        if any(current_env.get(k) != v for k, v in env.items()):
            raise ValueError('Mainnet runtime configuration differs. Reconcile the existing container privately first.')
    deploy.run(mainnet=True)


if __name__ == '__main__':
    try:
        run()
    except Exception:
        raise SystemExit('Mainnet deployment blocked or failed. Inspect its isolated build/status. Testnet wallets and node services were not changed.') from None
