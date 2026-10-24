"""Hidden address prompt; no key re-entry, wallet writes, network or raw errors."""
import argparse
import getpass
import json
from pathlib import Path
import resource
import subprocess
import sys
import warnings


def report(stage="preflight", saved=False, displayed=False):
    return dict(read_only=True, offline=True, stage=stage,
                saved_address_matches=saved, zodl_address_matches=displayed,
                same_account=saved and displayed, spending_control_proven=False,
                services_changed=False, sends_requested=0)


def main():
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        parser = argparse.ArgumentParser()
        parser.add_argument("--review", required=True)
        parser.add_argument("--binary", required=True)
        parser.add_argument("--sha256", required=True)
        args = parser.parse_args()
        if not sys.stdin.isatty() or not sys.stderr.isatty():
            raise ValueError()
        warnings.simplefilter("error", getpass.GetPassWarning)
        address = getpass.getpass("ZODL business account receive address (hidden): ").strip()
        if not 22 <= len(address) <= 502:
            raise ValueError()
        result = subprocess.run(
            ["/usr/bin/node", "--no-warnings", str(Path(__file__).with_suffix(".mjs"))],
            input=json.dumps(dict(review=args.review, binary=args.binary,
                                 sha256=args.sha256, displayAddress=address)),
            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=45, check=False, env={"PATH": "/usr/bin:/bin"})
        del address
        if result.returncode != 0 or len(result.stdout) > 1024:
            raise ValueError()
        value = json.loads(result.stdout)
        if value.get("stage") not in ("preflight", "saved_connection", "saved_key",
                                      "saved_address", "zodl_address", "complete"):
            raise ValueError()
        if (type(value.get("saved_address_matches")) is not bool
                or type(value.get("zodl_address_matches")) is not bool
                or value != report(value["stage"], value["saved_address_matches"],
                                   value["zodl_address_matches"])):
            raise ValueError()
        print(json.dumps(value))
        return 0 if value["same_account"] else 1
    except (Exception, KeyboardInterrupt):
        print(json.dumps(report()))
        return 1


if __name__ == "__main__":
    sys.exit(main())
