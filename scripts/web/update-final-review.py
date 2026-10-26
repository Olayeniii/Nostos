"""Build and switch only the private web preview; leave its observer untouched."""
import argparse
import hashlib
import re
import fcntl
import json
import os
from pathlib import Path
import runpy
import subprocess
import tarfile

REVIEW = Path("/home/ubuntu/nostos-web-review.CEfoZq")
REPO = Path("/home/ubuntu/nostos-arm64-build.4eQ9JP/source")
REVISION = ""
OLD = "nostos-private-review-recovery-33d9c0463192"
NEW = ""
IMAGE = "sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6"


def restore_worker(h):
    require=h["require"]
    config_path=REVIEW / "runtime/observer-config-detection-8a14cfaae7b5.json"
    normal=REVIEW / "commerce-build-dd1471c8cada/nostos-sdk-worker"
    normal_hash="d79ac8367d479565ebc374aa9b7a579520ed5604ba7ceb776280881e028997af"
    h["private"](config_path)
    h["private"](normal)
    require(hashlib.sha256(normal.read_bytes()).hexdigest()==normal_hash,"Normal worker verification failed.")
    before=config_path.read_bytes()
    current=json.loads(before)
    if current.get("binary")==str(normal) and current.get("binarySha256")==normal_hash:
        return
    temporary=REVIEW / "self-refund-build-bc9c5e0ee7a4"
    wrapper=temporary / "one-transaction-worker"
    backup=temporary / "previous-observer-config.json"
    for path in (wrapper,backup): h["private"](path)
    require(current.get("binary")==str(wrapper) and current.get("binarySha256")==hashlib.sha256(wrapper.read_bytes()).hexdigest(),"Unexpected worker configuration. Preserve it for review.")
    original=backup.read_bytes()
    desired=json.loads(original)
    require(desired==dict(current,binary=str(normal),binarySha256=normal_hash),"Rollback configuration differs.")
    matches=[]
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit(): continue
        try:
            args=(proc/"cmdline").read_bytes().rstrip(b"\0").split(b"\0")
            if len(args)==3 and args[2]==os.fsencode(config_path):
                require(proc.stat().st_uid==os.getuid(),"Unexpected observer owner.")
                matches.append((int(proc.name),Path(os.fsdecode(args[1])),Path(os.readlink(proc/"exe"))))
        except (FileNotFoundError,PermissionError,ProcessLookupError): pass
    require(len(matches)==1,"Expected one private observer broker.")
    pid,launcher,node=matches[0]
    require(launcher.resolve()==launcher and launcher.is_relative_to(REVIEW) and launcher.name=="run-service.mjs","Unexpected broker launcher.")
    def write(data):
        staged=config_path.with_name(config_path.name+".normal-next")
        with staged.open("xb") as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(staged,config_path)
    child=None
    h["stop_pid"](pid,launcher,config_path)
    try:
        write(original)
        child=h["start_broker"](node,launcher,config_path,REVIEW/"observer-normal-policy.log")
        h["wait_for"](lambda:child.poll() is None and h["http"]("/",38235,"POST")[0]==401)
        # Authenticated, read-only status call checks that the normal native worker starts.
        js='import {ProductStore} from "/app/apps/web/src/product-store.ts";import {observerWallet} from "/app/apps/web/src/merchant-observer.ts";const s=new ProductStore();try{const rows=s.db.prepare("SELECT merchant_id FROM merchant_observers WHERE status=\'connected\' LIMIT 2").all();if(rows.length!==1)throw Error();const v=await observerWallet(rows[0].merchant_id).call("getwalletstatus",[]);if(v.account_connected!==true)throw Error();console.log("healthy");}finally{s.close();}'
        output=h["docker"]("exec",OLD,"node","--import","/app/node_modules/tsx/dist/loader.mjs","--input-type=module","-e",js)
        require(output.strip()=="healthy","Normal observer status failed.")
        wrapper.chmod(0o600)
    except BaseException:
        if child is not None and child.poll() is None:
            h["stop_pid"](child.pid,launcher,config_path)
        write(before)
        restored=h["start_broker"](node,launcher,config_path,REVIEW/"observer-normal-rollback.log")
        h["wait_for"](lambda:restored.poll() is None and h["http"]("/",38235,"POST")[0]==401)
        raise


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
            "/app": (str(REVIEW / "recovery-web-33d9c0463192/source"), False),
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
        work = REVIEW / ("final-web-" + REVISION[:12])
        work.mkdir(mode=0o700, exist_ok=False)
        source = work / "source"
        source.mkdir(mode=0o700)
        subprocess.run(["git", "-C", str(REPO), "fetch", "--depth=1", "origin", REVISION], check=True)
        archive = work / "source.tar"
        subprocess.run(["git", "-C", str(REPO), "archive", "--format=tar", "--output=" + str(archive), REVISION], check=True)
        with tarfile.open(archive) as tree:
            tree.extractall(source, filter="data")
        prior = REVIEW / "recovery-web-33d9c0463192/source"
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
        # Restore normal worker policy before switching the web. Confirmed records remain intact.
        restore_worker(h)
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
            print(json.dumps(dict(installed=True, revision=REVISION, normal_worker_restored=True, temporary_exception_removed=True,
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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision",required=True)
    args=parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}",args.revision):
        parser.error("Exact reviewed revision required.")
    REVISION=args.revision
    NEW="nostos-private-review-final-"+REVISION[:12]
    run()
