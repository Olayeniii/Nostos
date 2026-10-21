"""CI helper: round-trip only the public fixture supplied by the Rust test."""
from pathlib import Path
import subprocess
import sys
import backup


def check(root):
    root = backup.directory(root)
    backup.require(root.name == "4b723cba-3e4d-4536-9c2e-e8129e2fb731")
    base = root.parent
    copies = base / "encrypted-fixture"
    copies.mkdir(mode=0o700)
    identity = copies / "identity"
    with backup.open_private(identity) as stream:
        subprocess.run(["age-keygen"], stdout=stream, stderr=subprocess.DEVNULL, check=True)
    recipient = subprocess.run(["age-keygen", "-y", str(identity)], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, check=True).stdout.decode().strip()
    archive = copies / "snapshot.age"
    backup.backup(root, archive, recipient, root.name)
    restored = base / "restored"
    restored.mkdir(mode=0o700)
    backup.restore(archive, restored / root.name, identity, root.name)


if __name__ == "__main__":
    try:
        backup.require(len(sys.argv) == 2)
        check(Path(sys.argv[1]))
    except Exception:
        sys.exit(1)
