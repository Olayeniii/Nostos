import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("commerce_install", Path(__file__).with_name("install-commerce-review.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class CommerceInstall(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.review = root / "review"
        self.install = root / "install"
        self.build = self.review / "build"
        self.source = self.build / "source"
        self.runtime = self.review / "runtime"
        for path in (self.source / "apps/web/.next", self.source / "apps/web/node_modules/next/dist/bin", self.runtime / "data", self.runtime / "rpc", self.install / "state"):
            path.mkdir(parents=True)
        (self.source / "apps/web/.next/BUILD_ID").write_text("synthetic")
        (self.source / "apps/web/node_modules/next/dist/bin/next").write_text("synthetic")
        self.env = self.runtime / "web.env"
        self.env.write_text("SYNTHETIC_EXISTING_KEY=preserved\n")
        (self.install / "state/service.cookie").write_text("synthetic:cookie")
        (self.runtime / "rpc/service.cookie").write_text("synthetic:cookie")
        (self.install / "nostos-sdk-worker").write_bytes(b"old fixture")
        (self.build / "nostos-sdk-worker").write_bytes(b"new fixture")
        (self.build / "nostos-sdk-worker").chmod(0o700)
        self.new_hash = hashlib.sha256(b"new fixture").hexdigest()
        self.old_hash = hashlib.sha256(b"old fixture").hexdigest()
        self.config = dict(root=str(self.install / "state"), binary=str(self.install / "nostos-sdk-worker"), binarySha256=self.old_hash, port=38235)
        (self.runtime / "observer-config.json").write_text(json.dumps(self.config))
        (self.build / "build-result.json").write_text(json.dumps(dict(revision=module.REVISION, binary_sha256=self.new_hash, source=str(self.source))))
        self.old = {"State": {"Running": True}, "Image": module.IMAGE, "Config": {"User": "1001:1001"}, "HostConfig": {"NetworkMode": "host"}, "Mounts": [
            dict(Destination="/app", Source=str(self.review / "source-settings-04775b7"), RW=False),
            dict(Destination="/preview", Source=str(self.runtime / "data"), RW=True),
            dict(Destination="/preview-rpc", Source=str(self.runtime / "rpc"), RW=False),
        ]}
        self.calls = []
        def docker(*args):
            self.calls.append(args)
            if args[0] == "inspect":
                return json.dumps([self.old if args[1] == module.OLD_WEB else {"State": {"Running": True}}])
            return ""
        def digest(path):
            if path.name == "service.mjs":
                return "dc6ccc9414ebd8d02242feaf6133b1c063c1b8512c190b2712d4f546d105beac"
            return hashlib.sha256(path.read_bytes()).hexdigest()
        self.child = Mock(pid=456)
        self.child.poll.return_value = None
        def http(path, port=3108, method="GET"):
            if port == 38235:
                return (401 if method == "POST" else 403), b""
            if path == "/api/product/network":
                return 200, b'{"network":"mainnet","commerceEnabled":true}'
            return (200 if path == "/sign-in" else 401), b""
        values = {"REVIEW": self.review, "INSTALL": self.install, "BUILD": self.build, "HASH": self.new_hash, "OLD_HASH": self.old_hash,
                  "private": Mock(), "broker_pid": Mock(return_value=123), "stop_pid": Mock(), "start_broker": Mock(return_value=self.child),
                  "docker": Mock(side_effect=docker), "digest": digest, "http": Mock(side_effect=http)}
        for key, value in values.items():
            context = patch.object(module, key, value)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(module.os, "getuid", return_value=1001)
        context.start()
        self.addCleanup(context.stop)

    def test_switch_preserves_original_config_key_and_mounts(self):
        original = (self.runtime / "observer-config.json").read_bytes()
        module.run()
        self.assertEqual((self.runtime / "observer-config.json").read_bytes(), original)
        self.assertEqual(self.env.read_text(), "SYNTHETIC_EXISTING_KEY=preserved\n")
        self.assertEqual((self.install / "nostos-sdk-worker").read_bytes(), b"old fixture")
        launch = next(args for args in self.calls if args[0] == "run")
        self.assertIn("NOSTOS_MAINNET_COMMERCE_PREVIEW=yes", launch)
        self.assertIn(str(self.runtime / "data") + ":/preview", launch)
        self.assertNotIn("nostos-web", launch)
        self.assertEqual(module.stop_pid.call_args.args[0], 123)
        new = json.loads((self.runtime / "observer-config-commerce-c370ee2.json").read_text())
        self.assertEqual(new["root"], self.config["root"])
        self.assertEqual(new["binarySha256"], self.new_hash)

    def test_hash_mismatch_refuses_before_stopping_any_process(self):
        (self.build / "nostos-sdk-worker").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            module.run()
        module.stop_pid.assert_not_called()
        module.start_broker.assert_not_called()

    def test_unexpected_mount_refuses_before_stopping_any_process(self):
        self.old["Mounts"].append(dict(Destination="/wallets", Source="/production/wallets", RW=True))
        with self.assertRaises(ValueError):
            module.run()
        module.stop_pid.assert_not_called()

    def test_changed_cookie_refuses_without_rotating_it(self):
        (self.runtime / "rpc/service.cookie").write_text("different")
        with self.assertRaises(ValueError):
            module.run()
        module.stop_pid.assert_not_called()
        self.assertEqual((self.install / "state/service.cookie").read_text(), "synthetic:cookie")

    def test_failed_web_health_restores_previous_broker_and_web(self):
        def wait(check, seconds=30):
            wait.count += 1
            if wait.count == 2:
                raise ValueError("synthetic failed health")
            self.assertTrue(check())
        wait.count = 0
        with patch.object(module, "wait_for", side_effect=wait):
            with self.assertRaises(ValueError):
                module.run()
        self.assertIn(("stop", "--time", "30", module.NEW_WEB), self.calls)
        self.assertIn(("start", module.OLD_WEB), self.calls)
        self.assertEqual(module.start_broker.call_count, 2)
        self.assertEqual(module.start_broker.call_args.args[2], self.runtime / "observer-config.json")
        self.assertEqual(module.stop_pid.call_args.args[0], 456)

    def test_retry_reuses_identical_private_config_and_refuses_changed_config(self):
        next_config = self.runtime / "observer-config-commerce-c370ee2.json"
        next_config.write_text(json.dumps(dict(self.config, binary=str(self.build / "nostos-sdk-worker"), binarySha256=self.new_hash)))
        before = next_config.read_bytes()
        module.run()
        self.assertEqual(next_config.read_bytes(), before)
        next_config.write_text(json.dumps(dict(self.config, port=9999)))
        module.stop_pid.reset_mock()
        with self.assertRaises(ValueError):
            module.run()
        module.stop_pid.assert_not_called()


class ObserverProbeProtocol(unittest.TestCase):
    def test_real_broker_rejects_get_and_challenges_unauthenticated_post(self):
        service = Path(__file__).resolve().parents[1] / "lightclient/service.mjs"
        source = ('import {createObserverService} from ' + json.dumps(service.as_uri()) + ';'
                  'const server=createObserverService({authorization:"Basic '+ 'a' * 40 +'",broker:{request(){throw Error("unexpected worker access")}}});'
                  'server.listen(0,"127.0.0.1",()=>process.stdout.write(String(server.address().port)+"\\n"));')
        child = subprocess.Popen(["node", "--input-type=module", "-e", source], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            port = int(child.stdout.readline().strip())
            self.assertEqual(module.http("/", port)[0], 403)
            self.assertEqual(module.http("/", port, method="POST")[0], 401)
        finally:
            child.terminate()
            child.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
