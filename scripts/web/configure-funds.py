"""Configure existing chain RPC access; no sends, copies or service changes."""
import argparse
import os
from pathlib import Path
from urllib.parse import urlsplit


def validate(url, cookie, buffer):
    parsed = urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Loopback HTTP RPC without credentials is required.')
    if not cookie.startswith('/') or any(c in cookie for c in '\r\n') or not 10000 <= buffer <= 10000000:
        raise ValueError('Absolute container cookie path and valid fee buffer required.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mainnet', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo.')
    url = input('Existing chain RPC URL on loopback: ').strip()
    cookie = input('Existing chain cookie path INSIDE the web container: ').strip()
    buffer = int(input('Refund fee allowance in zat per open payment [10000]: ').strip() or '10000')
    validate(url, cookie, buffer)
    root = Path('/home/ubuntu/nostos') / ('mainnet' if args.mainnet else '')
    root.mkdir(exist_ok=True, mode=0o700)
    prefix = 'NOSTOS_MAINNET_' if args.mainnet else 'NOSTOS_'
    fd = os.open(root / 'funds.env', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(prefix+'CHAIN_RPC_URL='+url+'\n'+prefix+'CHAIN_RPC_COOKIE_FILE='+cookie+'\nNOSTOS_REFUND_FEE_BUFFER_ZAT='+str(buffer)+'\n')
    print('Funds configuration saved privately. Existing cookie mounts must allow the web user to read it. No services changed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError):
        raise SystemExit('Configuration failed; inspect the private configuration before deploying.') from None
