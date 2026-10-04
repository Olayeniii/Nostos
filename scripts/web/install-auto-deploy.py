#!/usr/bin/env python3
"""Install only the deployment timer. Wallet and node services are untouched."""
import os
from pathlib import Path
import shutil
import subprocess

if os.geteuid() != 0:
    raise SystemExit('Run with sudo.')
source = Path(__file__).resolve().parent
repo = source.parents[1]
if repo != Path('/home/ubuntu/nostos/repo'):
    raise SystemExit('Expected /home/ubuntu/nostos/repo. No services changed.')
destination = Path('/usr/local/lib/nostos')
destination.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'auto-deploy.py', destination / 'auto-deploy.py')
os.chown(destination / 'auto-deploy.py', 0, 0)
os.chmod(destination / 'auto-deploy.py', 0o644)
for name in ('nostos-auto-deploy.service', 'nostos-auto-deploy.timer'):
    shutil.copyfile(source / name, Path('/etc/systemd/system') / name)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'nostos-auto-deploy.timer'], check=True)
print('Timer installed. Main is checked every five minutes. Full checks and rollback remain required.')
