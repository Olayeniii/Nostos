"""Prepare isolated observer-preview web settings. Default is read-only; never deploys."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import urllib.request
from urllib.parse import urlsplit

ROOT = Path('/home/ubuntu/nostos/mainnet')
DIAGNOSTIC = {'stage':'not_started'}
PUBLIC_ERRORS = frozenset((
    'Use sudo for private configuration checks.',
    'Use a separate exact HTTPS mainnet origin.',
    'Preview settings exist. Preserve and inspect them before changing anything.',
    'Expected a protected regular file.',
    'Unexpected RPC cookie format.',
    'RPC readiness check failed.',
    'Mainnet node metadata is unavailable.',
    'Expected numeric web UID:GID.',
    'Existing verified mail configuration is required.',
    'Invalid mail configuration.',
    'RPC redirects are refused.',
))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('RPC redirects are refused.')


def validate_origin(origin):
    parsed = urlsplit(origin)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)
            or parsed.hostname in ('nostos.iyforge.xyz', 'localhost', '127.0.0.1', '::1')
            or not re.fullmatch(r'[a-z0-9.-]+', parsed.hostname)):
        raise ValueError('Use a separate exact HTTPS mainnet origin.')
    return origin


def protected(path):
    mode = path.lstat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077:
        raise ValueError('Expected a protected regular file.')
    return path.read_text().strip()


def rpc(port, cookie, method, params):
    auth = base64.b64encode(cookie.encode()).decode()
    request = urllib.request.Request('http://127.0.0.1:'+str(port),
        data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),
        headers={'Content-Type':'application/json','Authorization':'Basic '+auth})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=15) as response:
        result = json.loads(response.read(2_000_001))
    if result.get('error') is not None or 'result' not in result:
        error = result.get('error')
        if isinstance(error, dict) and type(error.get('code')) is int:
            DIAGNOSTIC['rpc_error_code'] = error['code']
        raise ValueError('RPC readiness check failed.')
    return result['result']


def chain_identity(chain, status):
    if (not isinstance(chain, dict) or chain.get('chain') != 'main'
            or type(chain.get('blocks')) is not int
            or not re.fullmatch(r'[a-f0-9]{64}', chain.get('bestblockhash',''))):
        raise ValueError('Mainnet node metadata is unavailable.')
    tip = status.get('node_tip', {})
    return tip.get('height') == chain['blocks'] and tip.get('blockhash') == chain['bestblockhash']


def settings(origin, mail):
    validate_origin(origin)
    if not mail.get('NOSTOS_EMAIL_API_KEY') or not mail.get('NOSTOS_EMAIL_FROM'):
        raise ValueError('Existing verified mail configuration is required.')
    if any('\n' in v or '\r' in v for v in mail.values()):
        raise ValueError('Invalid mail configuration.')
    return {
        'NOSTOS_MAINNET_ENABLED':'yes',
        'NOSTOS_MAINNET_WALLET_MODE':'observer-preview',
        'NOSTOS_MAINNET_OBSERVER_RPC_URL':'http://127.0.0.1:38234',
        'NOSTOS_MAINNET_OBSERVER_RPC_COOKIE_FILE':'/wallet/observer/.cookie',
        'NOSTOS_MAINNET_CHAIN_RPC_URL':'http://127.0.0.1:38231',
        'NOSTOS_MAINNET_CHAIN_RPC_COOKIE_FILE':'/wallet/node/.cookie',
        'NOSTOS_WEB_TRUSTED_ORIGINS':origin,
        'NOSTOS_EMAIL_API_KEY':mail['NOSTOS_EMAIL_API_KEY'],
        'NOSTOS_EMAIL_FROM':mail['NOSTOS_EMAIL_FROM'],
    }


def write_private(path, value, uid=0, gid=0):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as file:
        os.fchmod(file.fileno(), 0o600)
        os.fchown(file.fileno(), uid, gid)
        file.write(value)


def run(origin, apply=False):
    DIAGNOSTIC.clear()
    DIAGNOSTIC['stage'] = 'operator_privileges'
    if os.geteuid() != 0:
        raise ValueError('Use sudo for private configuration checks.')
    DIAGNOSTIC['stage'] = 'https_origin'
    validate_origin(origin)
    # No new source profile may reuse existing data or silently replace credentials.
    DIAGNOSTIC['stage'] = 'existing_preview_settings'
    if (ROOT/'mainnet.env').exists() or (ROOT/'observer-rpc').exists():
        raise ValueError('Preview settings exist. Preserve and inspect them before changing anything.')
    DIAGNOSTIC['stage'] = 'observer_cookie'
    observer_cookie = protected(ROOT/'observer/.cookie')
    DIAGNOSTIC['stage'] = 'chain_cookie'
    chain_cookie = protected(ROOT/'node-rpc/.cookie')
    for cookie in (observer_cookie, chain_cookie):
        if not cookie.startswith('__cookie__:') or '\n' in cookie or '\r' in cookie:
            raise ValueError('Unexpected RPC cookie format.')
    DIAGNOSTIC['stage'] = 'chain_rpc'
    chain = rpc(38231, chain_cookie, 'getblockchaininfo', None)
    DIAGNOSTIC['stage'] = 'observer_rpc'
    status = rpc(38234, observer_cookie, 'getwalletstatus', [])
    DIAGNOSTIC['stage'] = 'chain_identity'
    matching = chain_identity(chain, status)
    result = {'read_only':not apply, 'eligible':matching, 'applied':False,
              'matching_chain_tip':matching, 'node_height':chain.get('blocks'),
              'observer_node_height':status.get('node_tip',{}).get('height'),
              'hosted_signer_configured':False, 'payments_enabled':False,
              'services_changed':False, 'sends_requested':0}
    if not matching:
        return result
    # Copy only mail fields and the numeric runtime user, never testnet wallet env.
    DIAGNOSTIC['stage'] = 'existing_web_configuration'
    template = json.loads(subprocess.check_output(
        ['docker','inspect','nostos-web'], stderr=subprocess.PIPE, text=True, timeout=15))[0]
    user = template['Config']['User']
    if not re.fullmatch(r'[0-9]+:[0-9]+', user):
        raise ValueError('Expected numeric web UID:GID.')
    existing = dict(v.split('=',1) for v in template['Config']['Env'] if '=' in v)
    mail_names = ('NOSTOS_EMAIL_API_KEY','NOSTOS_EMAIL_FROM')
    mail = {k:existing.get(k,'') for k in mail_names}
    mail_file = ROOT.parent/'email.env'
    if mail_file.exists():
        DIAGNOSTIC['stage'] = 'mail_file'
        for line in protected(mail_file).splitlines():
            key, separator, value = line.partition('=')
            if separator and key in mail_names:
                mail[key] = value
    DIAGNOSTIC['stage'] = 'mail_configuration'
    env = settings(origin, mail)
    result['mail_configured'] = True
    result['origin'] = origin
    if not apply:
        return result
    DIAGNOSTIC['stage'] = 'write_preview_settings'
    directory = ROOT/'observer-rpc'
    directory.mkdir(mode=0o700)
    uid, gid = map(int, user.split(':'))
    os.chown(directory, uid, gid)
    write_private(directory/'.cookie', observer_cookie+'\n', uid, gid)
    write_private(ROOT/'mainnet.env', ''.join(k+'='+v+'\n' for k,v in env.items()))
    return dict(result, applied=True, observer_cookie_snapshot_created=True,
                web_deployed=False, https_verified=False)


def failure(error, apply=False):
    # Never expose raw exceptions, HTTP bodies, subprocess output or private paths.
    reason = 'Private check failed; raw details were withheld.'
    if type(error) is ValueError and str(error) in PUBLIC_ERRORS:
        reason = str(error)
    elif isinstance(error, FileNotFoundError):
        reason = 'Required file is missing.'
    elif isinstance(error, PermissionError):
        reason = 'Required protected file could not be read.'
    result = {'read_only':not apply, 'preview_configuration_complete':False,
              'failed_stage':DIAGNOSTIC.get('stage','not_started'),
              'error_type':type(error).__name__, 'reason':reason,
              'services_changed':False, 'sends_requested':0}
    if 'rpc_error_code' in DIAGNOSTIC:
        result['rpc_error_code'] = DIAGNOSTIC['rpc_error_code']
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.origin, args.apply)))
    except Exception as error:
        print(json.dumps(failure(error, args.apply)))
        raise SystemExit(1) from None
