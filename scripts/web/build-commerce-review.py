"""Stage and validate a fresh private commerce build. Never switches services."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile

REVIEW = Path("/home/ubuntu/nostos-web-review.CEfoZq")
NATIVE = Path("/home/ubuntu/nostos-arm64-build.4eQ9JP")
PIN = "987382f67e622915228686e9f956c6a9c9a7514c"
IMAGE = "sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"


def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def stage(revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or platform.machine() != "aarch64" or os.getuid() != 1001:
        raise ValueError("Expected the Ubuntu ARM64 operator and exact revision.")
    for root in (REVIEW, NATIVE, NATIVE / "source", NATIVE / "upstream"):
        if root.resolve() != root or not root.is_dir() or root.stat().st_uid != os.getuid():
            raise ValueError("Unexpected build directory. Preserve existing files.")
    pinned = subprocess.check_output(["git", "-C", str(NATIVE / "upstream"), "rev-parse", "HEAD"], text=True).strip()
    if pinned != PIN:
        raise ValueError("Unexpected upstream revision.")
    prior = REVIEW / "source-settings-04775b7"
    for path in (prior / "node_modules", prior / "apps/web/node_modules"):
        if not path.is_dir():
            raise ValueError("Previous ARM64 dependencies are unavailable.")
    work = REVIEW / ("commerce-build-" + revision[:12])
    work.mkdir(mode=0o700, exist_ok=False)
    source = work / "source"
    source.mkdir(mode=0o700)
    run(["git", "-C", NATIVE / "source", "fetch", "--depth=1", "origin", revision])
    fetched = subprocess.check_output(["git", "-C", str(NATIVE / "source"), "rev-parse", "FETCH_HEAD"], text=True).strip()
    if fetched != revision:
        raise ValueError("Source revision mismatch.")
    archive = work / "source.tar"
    run(["git", "-C", NATIVE / "source", "archive", "--format=tar", "--output=" + str(archive), revision])
    with tarfile.open(archive) as tree:
        tree.extractall(source, filter="data")
    run(["cp", "-a", prior / "node_modules", source / "node_modules"])
    run(["cp", "-a", prior / "apps/web/node_modules", source / "apps/web/node_modules"])
    (work / "revision.txt").write_text(revision + "\n")
    # No runtime, credentials, wallet state or production mount enters this builder.
    run(["docker", "run", "--name", "nostos-commerce-build-" + revision[:12], "--user", "1001:1001",
         "--network=host", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only",
         "--memory=2g", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m", "-e", "npm_config_cache=/tmp/npm-cache",
         "-e", "NEXT_TELEMETRY_DISABLED=1", "-e", "NODE_OPTIONS=--max-old-space-size=1024",
         "-v", str(source) + ":/app", "-w", "/app", IMAGE, "sh", "-c",
         "npx --yes pnpm@11.25.0 check && npx --yes pnpm@11.25.0 --filter @nostos/web build"])
    sdk = work / "zallet"
    run(["git", "clone", "--no-hardlinks", "--no-checkout", NATIVE / "upstream", sdk])
    run(["git", "checkout", "--detach", PIN], cwd=sdk)
    scripts = source / "scripts/lightclient"
    modules = sdk / "zallet-core/examples/nostos_observer"
    modules.mkdir(parents=True)
    for name in ("storage", "transactions", "transaction_tests", "connection"):
        shutil.copyfile(scripts / (name + ".rs"), modules / (name + ".rs"))
    shutil.copyfile(scripts / "observer.rs", modules / "mod.rs")
    for old, new in (("worker.rs", "nostos_sdk_worker.rs"), ("observer_fixture.rs", "nostos_observer_fixture.rs")):
        shutil.copyfile(scripts / old, modules.parent / new)
    run(["python3", scripts / "prepare.py", sdk])
    env = dict(os.environ, CARGO_TARGET_DIR=str(NATIVE / "build/target"), CARGO_BUILD_JOBS="2", CARGO_INCREMENTAL="0",
               CARGO_PROFILE_RELEASE_DEBUG="0", CARGO_PROFILE_RELEASE_LTO="false",
               CARGO_PROFILE_RELEASE_CODEGEN_UNITS="16", CARGO_PROFILE_RELEASE_STRIP="debuginfo")
    run(["cargo", "+1.95.0", "test", "--locked", "--offline", "--release", "-p", "zallet-core", "--example", "nostos_observer_fixture"], cwd=sdk, env=env)
    run(["cargo", "+1.95.0", "build", "--locked", "--offline", "--release", "-p", "zallet-core", "--example", "nostos_sdk_worker"], cwd=sdk, env=env)
    binary = work / "nostos-sdk-worker"
    shutil.copyfile(NATIVE / "build/target/release/examples/nostos_sdk_worker", binary)
    binary.chmod(0o700)
    result = dict(revision=revision, source=str(source), binary=str(binary), binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
                  services_changed=False, commerce_enabled=False, sends_requested=0)
    (work / "build-result.json").write_text(json.dumps(result) + "\n")
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    stage(parser.parse_args().revision)
