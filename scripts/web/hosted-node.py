"""Authenticated loopback relay to a fixed hosted Zebra HTTPS provider.

Only public chain RPC and optional signed-transaction broadcast are accepted.
Wallet methods are rejected. Local authentication is not forwarded. Raw signed
transactions contain encrypted shielded data; no request/response bodies are logged.
"""
import argparse
import base64
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import ssl
import threading
import urllib.request
from urllib.parse import urlsplit

MAX_REQUEST = 4_300_000
MAX_RESPONSE = 16_000_000
READ_METHODS = frozenset(('getinfo', 'getblockchaininfo', 'getbestblockhash', 'getblockcount',
    'getblockhash', 'getblock', 'getblockheader', 'getrawmempool', 'getrawtransaction',
    'z_gettreestate', 'z_getsubtreesbyindex', 'getaddressbalance', 'getaddresstxids',
    'getaddressutxos', 'getmempoolinfo'))
# The pinned Zaino connector serializes Rust's unit type as JSON null for these
# no-argument reads. Normalize only that shape; argument-bearing and send methods
# must still supply arrays and pass the existing authorization/parameter checks.
NO_ARGUMENT_READ_METHODS = frozenset(('getinfo', 'getblockchaininfo', 'getbestblockhash',
    'getblockcount', 'getrawmempool', 'getmempoolinfo'))


class HostedNodeError(Exception):
    """Fixed, private-data-free failure."""


def validate_endpoint(endpoint):
    if not isinstance(endpoint, str) or any(c.isspace() for c in endpoint):
        raise HostedNodeError('Invalid hosted endpoint.')
    parsed = urlsplit(endpoint)
    if (parsed.scheme != 'https' or parsed.hostname != 'shared.eu-central-1.getblock.io'
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.port not in (None, 443) or not re.fullmatch(r'/[A-Za-z0-9_-]{16,256}/?', parsed.path)):
        raise HostedNodeError('Use the documented GetBlock Zcash mainnet HTTPS JSON-RPC endpoint.')
    return endpoint


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise HostedNodeError('Hosted endpoint redirects are rejected.')


class HostedNode:
    def __init__(self, endpoint, broadcast_enabled=False, opener=None):
        self.endpoint = validate_endpoint(endpoint)
        if type(broadcast_enabled) is not bool:
            raise HostedNodeError('Invalid broadcast configuration.')
        self.broadcast_enabled = broadcast_enabled
        self.opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()))

    def call(self, method, params=None):
        payload = self.forward({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or []})
        return payload['result']

    def forward(self, payload):
        if (not isinstance(payload, dict) or set(payload) - {'jsonrpc', 'id', 'method', 'params'}
                or not isinstance(payload.get('method'), str)
                or isinstance(payload.get('id'), (dict, list, bool))):
            raise HostedNodeError('Invalid chain RPC request.')
        method = payload['method']
        if method not in READ_METHODS and not (method == 'sendrawtransaction' and self.broadcast_enabled):
            raise HostedNodeError('Chain RPC method is not enabled.')
        params = payload.get('params', [])
        if params is None and method in NO_ARGUMENT_READ_METHODS:
            params = []
        if not isinstance(params, list):
            raise HostedNodeError('Invalid chain RPC request.')
        if method == 'sendrawtransaction' and (len(params) != 1 or not isinstance(params[0], str)
                or not re.fullmatch(r'[a-fA-F0-9]+', params[0]) or len(params[0]) % 2):
            raise HostedNodeError('A signed raw transaction is required.')
        body = json.dumps({'jsonrpc': '2.0', 'id': payload.get('id'), 'method': method, 'params': params}).encode()
        if len(body) > MAX_REQUEST:
            raise HostedNodeError('Chain RPC request is too large.')
        try:
            request = urllib.request.Request(self.endpoint, data=body,
                headers={'Content-Type': 'application/json'}, method='POST')
            with self.opener.open(request, timeout=25) as response:
                if response.status != 200:
                    raise HostedNodeError('Hosted chain RPC is unavailable.')
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise HostedNodeError('Hosted chain RPC response is too large.')
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get('error') is not None or 'result' not in result:
                raise HostedNodeError('Hosted chain RPC request failed.')
            # Never forward provider error text, HTTP headers or unrequested fields.
            return {'jsonrpc': '2.0', 'id': payload.get('id'), 'result': result['result'], 'error': None}
        except Exception:
            raise HostedNodeError('Hosted chain RPC request failed.') from None


def probe(client):
    """Public metadata only. Never signs, creates accounts, sends or persists data."""
    if client.broadcast_enabled:
        raise HostedNodeError('Compatibility probe must use a read-only client.')
    passed = []
    def call(method, params=None):
        value = client.call(method, params)
        passed.append(method)
        return value
    info = call('getblockchaininfo')
    if (not isinstance(info, dict) or info.get('chain') != 'main' or type(info.get('blocks')) is not int
            or info['blocks'] <= 0 or not re.fullmatch(r'[a-f0-9]{64}', info.get('bestblockhash', ''))
            or not isinstance(info.get('upgrades'), dict)):
        raise HostedNodeError('Mainnet chain identity or upgrade metadata is unavailable.')
    if not any(isinstance(v, dict) and v.get('status') == 'active' for v in info['upgrades'].values()):
        raise HostedNodeError('Active upgrade metadata is unavailable.')
    height, blockhash = info['blocks'], info['bestblockhash']
    if call('getblockhash', [height]) != blockhash:
        raise HostedNodeError('Chain tip changed or block hash is inconsistent. Repeat the read-only probe.')
    for method in ('getinfo', 'getblockcount', 'getbestblockhash'):
        call(method)
    block = call('getblock', [blockhash, 1])
    if not isinstance(block, dict) or block.get('hash') != blockhash or block.get('height') != height:
        raise HostedNodeError('Verbose block data is incompatible.')
    raw = call('getblock', [blockhash, 0])
    if not isinstance(raw, str) or not re.fullmatch(r'[a-fA-F0-9]+', raw) or len(raw) % 2:
        raise HostedNodeError('Raw block data is incompatible.')
    call('getblockheader', [blockhash, True])
    if not isinstance(call('getrawmempool'), list):
        raise HostedNodeError('Mempool data is incompatible.')
    tree = call('z_gettreestate', [blockhash])
    if not isinstance(tree, dict) or tree.get('hash') != blockhash or any(pool not in tree for pool in ('sapling', 'orchard', 'ironwood')):
        raise HostedNodeError('Required shielded tree data is unavailable.')
    for pool in ('sapling', 'orchard', 'ironwood'):
        roots = call('z_getsubtreesbyindex', [pool, 0, 1])
        if not isinstance(roots, dict) or not isinstance(roots.get('subtrees'), list):
            raise HostedNodeError('Required shielded subtree data is unavailable.')
    txs = block.get('tx')
    if not isinstance(txs, list) or not txs or not isinstance(txs[0], str):
        raise HostedNodeError('Public block transaction references are unavailable.')
    transaction = call('getrawtransaction', [txs[0], 0])
    if not isinstance(transaction, str) or not re.fullmatch(r'[a-fA-F0-9]+', transaction):
        raise HostedNodeError('Raw transaction data is incompatible.')
    if call('getblockhash', [height]) != blockhash:
        raise HostedNodeError('Chain changed during probe. Repeat the read-only probe.')
    return {'read_only': True, 'network': 'mainnet', 'chain_rpc_probe_passed': True,
        'height': height, 'checked_methods': sorted(set(passed)), 'sends_requested': 0,
        'wallet_sync_verified': False, 'broadcast_verified': False,
        'scope': 'Hosted public-chain RPC metadata only; not wallet sync, exact Zaino response decoding, privacy certification or a live payment/refund proof.'}


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    def __init__(self, address, client, cookie):
        if address[0] != '127.0.0.1' or not cookie or ':' not in cookie:
            raise HostedNodeError('Authenticated loopback binding is required.')
        self.client = client
        self.authorization = 'Basic ' + base64.b64encode(cookie.encode()).decode()
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, RelayHandler)
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()
    def handle_error(self, request, client_address):
        pass  # No raw request, exception, URL or credential logging.


class RelayHandler(BaseHTTPRequestHandler):
    server_version = 'NostosChainRelay'
    sys_version = ''
    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def log_message(self, *args):
        pass
    def do_POST(self):
        response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32000, 'message': 'Chain RPC unavailable.'}}
        status = 200
        try:
            if self.path != '/' or self.headers.get('Origin') or not hmac.compare_digest(self.headers.get('Authorization', ''), self.server.authorization):
                status = 403
                raise HostedNodeError()
            if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                status = 400
                raise HostedNodeError()
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_REQUEST:
                status = 413
                raise HostedNodeError()
            payload = json.loads(self.rfile.read(length))
            response = self.server.client.forward(payload)
        except Exception:
            pass
        body = json.dumps(response).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        self.send_error(405, 'Method unavailable')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    if not args.serve:
        raise HostedNodeError('Use configure-hosted-node.py for private setup and probe.')
    credentials = Path(os.environ['CREDENTIALS_DIRECTORY'])
    settings = json.loads((credentials / 'endpoint.json').read_text())
    cookie = (credentials / 'rpc.cookie').read_text().strip()
    client = HostedNode(settings['endpoint'], settings.get('broadcast_enabled', False))
    RelayServer(('127.0.0.1', 38231), client, cookie).serve_forever()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Hosted chain relay stopped. Private configuration was not printed.') from None
