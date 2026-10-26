"""Build and switch only the private web preview; leave its observer untouched."""
import fcntl
import json
import os
from pathlib import Path
import runpy
import subprocess
import tarfile

REVIEW = Path("/home/ubuntu/nostos-web-review.CEfoZq")
REPO = Path("/home/ubuntu/nostos-arm64-build.4eQ9JP/source")
REVISION = "33d9c0463192541e525ba5dcb2abc83a1ec8ca52"
OLD = "nostos-private-review-wallet-e1aa80f30623"
NEW = "nostos-private-review-recovery-" + REVISION[:12]
IMAGE = "sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"


def run():
    if os.getuid() != 1001:
        raise ValueError("Use the ubuntu operator without sudo.")
    os.umask(0o077)
    helper = REVIEW / "commerce-build-dd1471c8cada/source/scripts/web/install-refund-detection-review.py"
    h = runpy.run_path(str(helper))
    require, docker = h["require"], h["docker"]
    h["private"](REVIEW, directory=True)
    runtime = REVIEW / "runtime"
    for path in (runtime, runtime / "data", runtime / "rpc"):
        h["private"](path, directory=True)
    h["private"](runtime / "web.env")
    with (REVIEW / "commerce-install.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = json.loads(docker("inspect", OLD))[0]
        expected_mounts = {
            "/app": (str(REVIEW / "wallet-web-e1aa80f30623/source"), False),
            "/preview": (str(runtime / "data"), True),
            "/preview-rpc": (str(runtime / "rpc"), False),
        }
        require(old["State"]["Running"] and old["Image"] == IMAGE
                and old["Config"]["User"] == "1001:1001"
                and old["HostConfig"]["NetworkMode"] == "host"
                and {m["Destination"]: (m["Source"], m["RW"]) for m in old["Mounts"]} == expected_mounts,
                "Private web deployment changed. No services switched.")
        require(not docker("ps", "-a", "--filter", "name=^/" + NEW + "$", "--format", "{{.ID}}").strip(),
                "Replacement already exists. Preserve it for inspection.")
        work = REVIEW / ("recovery-web-" + REVISION[:12])
        work.mkdir(mode=0o700, exist_ok=False)
        source = work / "source"
        source.mkdir(mode=0o700)
        subprocess.run(["git", "-C", str(REPO), "fetch", "--depth=1", "origin", REVISION], check=True)
        archive = work / "source.tar"
        subprocess.run(["git", "-C", str(REPO), "archive", "--format=tar", "--output=" + str(archive), REVISION], check=True)
        with tarfile.open(archive) as tree:
            tree.extractall(source, filter="data")
        prior = REVIEW / "wallet-web-e1aa80f30623/source"
        for relative in ("node_modules", "apps/web/node_modules"):
            subprocess.run(["cp", "-a", str(prior / relative), str(source / relative)], check=True)
        builder = runpy.run_path(str(source / "scripts/web/build-commerce-review.py"))
        command = builder["web_build_command"](work, source, REVISION)
        command[-1] = command[-1].replace('node /build-tools/node_modules/pnpm/bin/pnpm.cjs check && ', '')
        subprocess.run(command, check=True)
        require((source / "apps/web/.next/BUILD_ID").is_file(), "Web build incomplete.")
        # Read only counts. Never print a checkout token, receiver, memo or key.
        inspection = docker("exec", OLD, "node", "--import", "/app/node_modules/tsx/dist/loader.mjs", "--input-type=module", "-e",
            'import {ProductStore} from "/app/apps/web/src/product-store.ts";'
            'const s=new ProductStore();const rows=s.db.prepare("SELECT id FROM checkouts WHERE status=\'unpaid\'").all();'
            'console.log(JSON.stringify({unpaid_requests:rows.length,saved_refund_routes:rows.filter(r=>Boolean(s.checkout(r.id)?.route)).length}));s.close();')
        print(inspection.strip(), flush=True)
        stopped = False
        attempted = False
        try:
            docker("stop", "--time", "30", OLD)
            stopped = True
            attempted = True
            docker("run", "-d", "--name", NEW, "--network=host", "--user", "1001:1001",
                "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--memory=1536m",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "--env-file", str(runtime / "web.env"),
                "-e", "NOSTOS_MAINNET_COMMERCE_PREVIEW=yes", "-v", str(source) + ":/app:ro",
                "-v", str(runtime / "data") + ":/preview", "-v", str(runtime / "rpc") + ":/preview-rpc:ro",
                "-w", "/app/apps/web", IMAGE, "node", "/app/apps/web/node_modules/next/dist/bin/next",
                "start", "--hostname", "127.0.0.1", "--port", "3108")
            def healthy():
                status, raw = h["http"]("/api/product/network")
                return (status == 200 and json.loads(raw) == {"network": "mainnet", "commerceEnabled": True}
                        and h["http"]("/sign-in")[0] == 200 and h["http"]("/api/product/me")[0] == 401)
            h["wait_for"](healthy)
            print(json.dumps(dict(installed=True, revision=REVISION, worker_unchanged=True,
                existing_data_preserved=True, web_http=200, account_auth_http=401, sends_requested=0)), flush=True)
        except BaseException:
            if attempted:
                try:
                    if json.loads(docker("inspect", NEW))[0]["State"]["Running"]:
                        docker("stop", "--time", "30", NEW)
                except subprocess.CalledProcessError:
                    pass
            if stopped:
                docker("start", OLD)
                h["wait_for"](lambda: h["http"]("/sign-in")[0] == 200 and h["http"]("/api/product/me")[0] == 401)
            raise


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        print(json.dumps(dict(installed=False, message=str(error) if isinstance(error, ValueError)
            else "Web update stopped. Preserve the staged build and inspect this log.", sends_requested=0)), flush=True)
        raise SystemExit(1)
