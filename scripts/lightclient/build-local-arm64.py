"""Build an isolated ARM64 observer package without Actions or service changes."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

PIN = "987382f67e622915228686e9f956c6a9c9a7514c"


def run(args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def validate_host(machine=None, release=None):
    machine = machine or platform.machine()
    release = release if release is not None else platform.freedesktop_os_release()
    if machine not in ("aarch64", "arm64") or release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "24.04":
        raise ValueError("Ubuntu 24.04 ARM64 build host required")


def validate_checkout(root, revision):
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or git(root, "rev-parse", "HEAD") != revision:
        raise ValueError("Exact source revision required")
    if git(root, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Clean source checkout required")


def build(source, upstream, workspace, revision):
    validate_host()
    validate_checkout(source, revision)
    validate_checkout(upstream, PIN)
    for name in ("git", "cargo", "rustup", "clang", "pkg-config", "protoc", "age", "age-keygen", "node"):
        if not shutil.which(name):
            raise ValueError("Missing build dependency: " + name)
    run(["rustup", "run", "1.95.0", "rustc", "--version"])
    # A fresh directory only. No checkout, build cache or service is overwritten.
    workspace.mkdir(mode=0o700, parents=False, exist_ok=False)
    sdk = workspace / "zallet"
    run(["git", "clone", "--no-hardlinks", "--no-checkout", str(upstream), str(sdk)])
    run(["git", "checkout", "--detach", PIN], cwd=sdk)
    scripts = source / "scripts/lightclient"
    modules = sdk / "zallet-core/examples/nostos_observer"
    modules.mkdir(parents=True)
    for name in ("storage", "transactions", "transaction_tests", "connection"):
        shutil.copyfile(scripts / (name + ".rs"), modules / (name + ".rs"))
    shutil.copyfile(scripts / "observer.rs", modules / "mod.rs")
    for source_name, target_name in (("worker.rs", "nostos_sdk_worker.rs"), ("observer_fixture.rs", "nostos_observer_fixture.rs")):
        shutil.copyfile(scripts / source_name, modules.parent / target_name)
    run([sys.executable, str(scripts / "prepare.py"), str(sdk)])
    env = dict(os.environ, CARGO_BUILD_JOBS="2", CARGO_INCREMENTAL="0",
               CARGO_PROFILE_RELEASE_DEBUG="0", CARGO_PROFILE_RELEASE_LTO="false",
               CARGO_PROFILE_RELEASE_CODEGEN_UNITS="16", CARGO_PROFILE_RELEASE_STRIP="debuginfo",
               CARGO_TARGET_DIR=str(workspace / "target"), NOSTOS_BACKUP_FIXTURE=str(scripts / "backup_fixture.py"))
    run([sys.executable, "-m", "unittest", "discover", "-s", str(scripts), "-p", "test_backup.py"], env=env)
    run(["node", "--test", str(scripts / "service.test.mjs")], env=env)
    run(["cargo", "+1.95.0", "test", "--locked", "--release", "-p", "zallet-core", "--example", "nostos_observer_fixture"], cwd=sdk, env=env)
    run(["cargo", "+1.95.0", "build", "--locked", "--release", "-p", "zallet-core", "--example", "nostos_sdk_worker"], cwd=sdk, env=env)
    # Recheck both checkouts before stamping the output with their revisions.
    validate_checkout(source, revision)
    validate_checkout(upstream, PIN)
    binary = workspace / "target/release/examples/nostos_sdk_worker"
    run(["ldd", str(binary)])
    spec = importlib.util.spec_from_file_location("sdk_package", scripts / "package-arm64.py")
    packager = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packager)
    bundle = workspace / "bundle"
    packager.package(binary, sdk / "Cargo.lock", bundle, local_revision=revision)
    artifact = workspace / "nostos-sdk-preview-arm64.zip"
    with zipfile.ZipFile(artifact, "w", compression=zipfile.ZIP_STORED) as output:
        for name in ("nostos-sdk-preview-arm64.tar.gz", "provenance.json", "SHA256SUMS"):
            output.write(bundle / name, name)
    checksum = packager.digest(artifact)
    run([sys.executable, str(source / "scripts/web/inspect-sdk-package.py"), str(artifact), "--revision", revision, "--artifact-sha256", checksum])
    print(json.dumps(dict(artifact=str(artifact), sha256=checksum, revision=revision, build_origin="local", services_changed=False, sends_requested=0)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--upstream", type=Path, required=True, help="Existing clean pinned Zallet checkout")
    parser.add_argument("--workspace", type=Path, required=True, help="New directory outside both checkouts")
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    source, upstream, workspace = (p.resolve() for p in (args.source, args.upstream, args.workspace))
    if any(workspace.is_relative_to(root) for root in (source, upstream)):
        parser.error("Build workspace must be outside source checkouts")
    build(source, upstream, workspace, args.revision)
