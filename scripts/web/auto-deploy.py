#!/usr/bin/env python3
"""Poll the existing origin/main and use the isolated, checked deployment helper."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import subprocess

REPO = Path('/home/ubuntu/nostos/repo')
STATE = Path('/home/ubuntu/nostos/auto-deploy-state.json')


def command(args, *, git=False):
    if git:
        owner = pwd.getpwuid(REPO.stat().st_uid).pw_name
        args = ['runuser', '-u', owner, '--', 'git', '-C', str(REPO), *args]
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL,
                                   timeout=90).strip()


def eligible(head, target, dirty, branch, previous):
    return (not dirty and branch == 'main' and
            bool(re.fullmatch(r'[a-f0-9]{40}', target)) and
            previous.get('attempt') != target)


def run():
    if os.geteuid() != 0:
        raise RuntimeError('Run through the installed root service.')
    with open('/home/ubuntu/nostos/auto-deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        branch = command(['branch', '--show-current'], git=True)
        dirty = command(['status', '--porcelain'], git=True)
        if dirty or branch != 'main':
            print('Deployment held: repository has changes or is not on main.')
            return
        # Never put remote URLs or Git authentication errors in the journal.
        command(['fetch', '--quiet', 'origin',
                 'refs/heads/main:refs/remotes/origin/main'], git=True)
        target = command(['rev-parse', 'refs/remotes/origin/main'], git=True)
        head = command(['rev-parse', 'HEAD'], git=True)
        previous = json.loads(STATE.read_text()) if STATE.exists() else {}
        if not eligible(head, target, dirty, branch, previous):
            return
        sources = command(['docker', 'inspect', 'nostos-web', '--format',
                           '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}'])
        if Path(sources).name.startswith(target[:12] + '-'):
            return
        # Refuse rewritten history or local divergence. Do not reset local work.
        command(['merge-base', '--is-ancestor', head, target], git=True)
        command(['merge', '--ff-only', '--quiet', target], git=True)
        # A failed commit is attempted once. A new main commit or explicit retry
        # resets the gate; no expensive automatic rebuild loop on the 1 OCPU VPS.
        fd = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump({'attempt': target, 'status': 'building'}, file)
        result = subprocess.run(['python3', str(REPO / 'scripts/web/deploy.py')],
                                cwd=REPO, check=False)
        STATE.write_text(json.dumps({'attempt': target,
                         'status': 'healthy' if result.returncode == 0 else 'failed'}))
        if result.returncode:
            raise RuntimeError('Deployment failed; this commit is held for review.')
        print('Automatic deployment healthy: ' + target[:12])


if __name__ == '__main__':
    try:
        run()
    except BlockingIOError:
        pass
    except Exception:
        raise SystemExit('Automatic deployment held. Inspect the build status; private configuration was not printed.') from None
