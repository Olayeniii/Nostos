#!/usr/bin/env python3
"""Write the operator's mail settings outside Git, without echoing the key."""
import json
import getpass
import os
from pathlib import Path
import re
if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
sender = input('Verified Resend sender, e.g. NOSTOS <accounts@your-domain>: ').strip()
key = getpass.getpass('Resend sending API key (hidden): ').strip()
if not re.fullmatch(r'[^\r\n]{3,254}', sender) or '@' not in sender or not key or '\n' in key or '\r' in key:
    raise SystemExit('Invalid mail settings. Nothing saved.')
path = Path('/home/ubuntu/nostos/email.env')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd,0o600)
os.fchown(fd,0,0)
with os.fdopen(fd,'w') as file:
    file.write('NOSTOS_EMAIL_FROM='+sender+'\nNOSTOS_EMAIL_API_KEY='+key+'\n')
state = path.parent / 'auto-deploy-state.json'
if state.exists():
    previous = json.loads(state.read_text())
    if previous.get('status') == 'failed':
        state.write_text(json.dumps({'attempt': None, 'status': 'mail_configured'}))
print('Mail settings saved privately outside the repository. No keys printed.')
