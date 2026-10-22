"""Read public Cargo lock inventories and query OSV. No credentials or wallets.

Informational RustSec notices are reported separately, never hidden or called
clean. An unavailable/incomplete query or a vulnerability fails the build.
"""
import concurrent.futures
import json
from pathlib import Path
import sys
import tomllib
import urllib.request


def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request("https://api.osv.dev/v1/" + path, data=data,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "NOSTOS-public-dependency-audit"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def audit(paths):
    packages = sorted({(p["name"], p["version"]) for path in paths
                       for p in tomllib.loads(path.read_text())["package"]
                       if p.get("source", "").startswith("registry+")})
    queries = [{"package": {"ecosystem": "crates.io", "name": name}, "version": version}
               for name, version in packages]
    result = request("querybatch", {"queries": queries})["results"]
    if len(result) != len(packages) or any(r.get("next_page_token") for r in result):
        raise ValueError("Incomplete advisory inventory")
    ids = sorted({v["id"] for r in result for v in r.get("vulns", [])})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        details = dict(zip(ids, pool.map(lambda item: request("vulns/" + item), ids)))
    findings = []
    for package, matches in zip(packages, result):
        for match in matches.get("vulns", []):
            detail = details[match["id"]]
            if detail.get("withdrawn"):
                continue
            relevant = [a for a in detail.get("affected", [])
                        if a.get("package", {}).get("name") == package[0]]
            if not relevant:
                raise ValueError("Advisory package mismatch")
            notices = [a.get("database_specific", {}).get("informational") for a in relevant]
            informational = bool(notices) and all(notices)
            findings.append({"package": package[0], "version": package[1], "id": match["id"],
                             "summary": detail.get("summary"), "informational": informational,
                             "notice_types": sorted(set(n for n in notices if n))})
    return {"registry_packages_checked": len(packages),
            "vulnerabilities": [f for f in findings if not f["informational"]],
            "informational_notices": [f for f in findings if f["informational"]],
            "git_dependencies_reviewed": False}


if __name__ == "__main__":
    try:
        report = audit([Path(path) for path in sys.argv[1:]])
        if not sys.argv[1:]:
            raise ValueError("No lock files")
        print(json.dumps(report, indent=2))
        sys.exit(1 if report["vulnerabilities"] else 0)
    except Exception:
        raise SystemExit("Cargo advisory check unavailable or incomplete; not a clean result.") from None
