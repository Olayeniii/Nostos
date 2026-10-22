"""Invented subprocess fixtures only; no wallet keys, network or live profiles."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import struct
import platform
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("operator-control.py")
SPEC = importlib.util.spec_from_file_location("private_operator_control", SCRIPT)
OPERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OPERATOR)


class OperatorControlTests(unittest.TestCase):
    def test_non_terminal_refuses_before_reading_or_creating_a_profile(self):
        with tempfile.TemporaryDirectory() as root:
            profile = Path(root) / "never_created"
            result = subprocess.run([sys.executable, str(SCRIPT), "prepare", "/unused", str(profile), "0" * 64],
                                    input="invented_private_input", capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout), OPERATOR.failed())
            self.assertNotIn("invented_private", result.stdout + result.stderr)
            self.assertFalse(profile.exists())

    def test_profile_rejects_unrelated_wallet_files_symlinks_and_hardlinks(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            profile = base / "profile"
            OPERATOR.profile(profile, True)
            victim = base / "untouched"
            victim.write_text("preserve")
            victim.chmod(0o600)
            link = profile / "attempt.enc.tmp"
            for hard in (False, True):
                if hard:
                    os.link(victim, link)
                else:
                    link.symlink_to(victim)
                with self.assertRaises(ValueError):
                    OPERATOR.profile(profile, False)
                self.assertEqual(victim.read_text(), "preserve")
                link.unlink()
            (profile / "existing_wallet_data").write_text("untouched")
            with self.assertRaises(ValueError):
                OPERATOR.profile(profile, False)
            self.assertEqual((profile / "existing_wallet_data").read_text(), "untouched")

    def test_old_node_is_refused_before_private_prompts(self):
        fake = subprocess.CompletedProcess([], 0, stdout="v24.21.0\n", stderr="")
        with patch.object(OPERATOR.shutil, "which", return_value="/fake/node"), patch.object(OPERATOR.subprocess, "run", return_value=fake):
            with self.assertRaises(ValueError):
                OPERATOR.node_runtime()

    def test_unbounded_or_excessive_resource_scope_is_refused(self):
        files = {"/proc/self/cgroup": "0::/private-test-scope\n",
                 "/sys/fs/cgroup/private-test-scope/memory.max": "2147483648\n",
                 "/sys/fs/cgroup/private-test-scope/cpu.max": "50000 100000\n"}
        def read(path, *args, **kwargs):
            return files[str(path)]
        with patch.object(OPERATOR.Path, "read_text", read), patch.object(OPERATOR.Path, "resolve", lambda p, **kwargs: p):
            OPERATOR.resource_scope()
            for field, bad in [("memory.max", "max"), ("memory.max", "4294967296"),
                               ("cpu.max", "max 100000"), ("cpu.max", "100000 100000")]:
                path = "/sys/fs/cgroup/private-test-scope/" + field
                old = files[path]
                files[path] = bad
                with self.assertRaises(ValueError):
                    OPERATOR.resource_scope()
                files[path] = old

    def test_unexpected_child_fields_and_raw_errors_are_not_returned_or_displayed(self):
        for report in [dict(OPERATOR.failed(), private="invented_private_payload"),
                       {**OPERATOR.failed(), "confirmed": "invented_private_payload"},
                       {**OPERATOR.failed(), "passed": 1}]:
            fake = subprocess.CompletedProcess([], 0, stdout=json.dumps(report), stderr="invented_private_payload")
            with patch.object(OPERATOR, "run_node", return_value=fake), patch.object(OPERATOR.sys, "stderr", io.StringIO()) as output:
                with self.assertRaises(ValueError):
                    OPERATOR.invoke("/fake/node", Path("/fake"), "verify", Path("/profile"), "0" * 64, {})
                self.assertNotIn("invented_private", output.getvalue())

    def test_only_neutral_control_handoff_can_reach_the_private_terminal(self):
        success = dict(OPERATOR.failed(), passed=True, prepared=True, reserved=True)
        for memo in ["invented_private_memo", "uview1invented", "nostos:control:" + "a" * 32]:
            payload = {**success, "handoff": dict(receiver="u1" + "q" * 80, memo=memo,
                amountZat=10000, maxFeeZat=10000, maxDebitZat=20000)}
            fake = subprocess.CompletedProcess([], 0, stdout=json.dumps(payload), stderr="")
            with patch.object(OPERATOR, "run_node", return_value=fake), patch.object(OPERATOR.sys, "stderr", io.StringIO()) as output:
                if memo.startswith("nostos:control:"):
                    self.assertEqual(OPERATOR.invoke("/node", Path("/fake"), "handoff", Path("/profile"), "0" * 64, {}), success)
                    self.assertIn(memo, output.getvalue())
                else:
                    with self.assertRaises(ValueError):
                        OPERATOR.invoke("/node", Path("/fake"), "handoff", Path("/profile"), "0" * 64, {})
                    self.assertEqual(output.getvalue(), "")

    def test_manifest_requires_independently_reviewed_hash_and_exact_files(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            hashes = {}
            for name in OPERATOR.FILES:
                target = path / name
                target.write_text("invented_package_source")
                target.chmod(0o700 if name == "nostos-control-check" else 0o600)
                hashes[name] = hashlib.sha256(target.read_bytes()).hexdigest()
            manifest = dict(format="nostos-private-control-v1", sdk_commit="987382f67e622915228686e9f956c6a9c9a7514c",
                            sha256=hashes, signing_supported=False, wallet_files_included=False)
            file = path / "provenance.json"
            file.write_text(json.dumps(manifest)); file.chmod(0o600)
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            self.assertEqual(OPERATOR.package(path, digest), manifest)
            with self.assertRaises(ValueError):
                OPERATOR.package(path, "0" * 64)
            (path / "journal.js").write_text("changed")
            with self.assertRaises(ValueError):
                OPERATOR.package(path, digest)

    def test_package_contains_only_fixed_sources_and_validated_transport_metadata(self):
        source = SCRIPT.parent.parent / "lightclient"
        policy_spec = importlib.util.spec_from_file_location("operator_policy_fixture", source / "transport_security.py")
        policy = importlib.util.module_from_spec(policy_spec)
        policy_spec.loader.exec_module(policy)
        spec = importlib.util.spec_from_file_location("control_package_fixture", source / "package-control.py")
        packager = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"transport_security": policy}):
            spec.loader.exec_module(packager)
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            binary = base / "checker"
            header = bytearray(64)
            header[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<H", header, 18, {"x86_64": 62, "aarch64": 183}[platform.machine()])
            binary.write_bytes(header)
            compiled = base / "compiled"
            compiled.mkdir()
            for name in ("journal.js", "verification.js", "wallet.sqlite"):
                (compiled / name).write_text("invented_fixture")
            lock = base / "Cargo.lock"
            lock.write_text("\n".join('[[package]]\nname = "' + name + '"\nversion = "' + values[1]
                + '"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "'
                + values[3] + '"\n' for name, values in policy.PINS.items()))
            output = base / "package"
            with patch("builtins.print"):
                packager.package(binary, compiled, lock, output)
            metadata = json.loads((output / "provenance.json").read_text())
            self.assertEqual(set(metadata["sha256"]), OPERATOR.FILES)
            self.assertFalse((output / "wallet.sqlite").exists())
            self.assertFalse(metadata["signing_supported"])
            self.assertEqual(metadata["sends_requested"], 0)
            for name, digest in metadata["sha256"].items():
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            binary.write_bytes(b"not-an-ELF")
            with self.assertRaises(ValueError):
                packager.package(binary, compiled, lock, base / "rejected")
            self.assertFalse((base / "rejected").exists())

    def test_timeout_kills_only_the_new_operator_process_group(self):
        from unittest.mock import MagicMock
        process = MagicMock()
        process.pid = 123456
        process.poll.return_value = None
        process.communicate.side_effect = subprocess.TimeoutExpired("fixture", 1250)
        with patch.object(OPERATOR.subprocess, "Popen", return_value=process) as popen, patch.object(OPERATOR.os, "killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                OPERATOR.run_node(["/invented/node"], {})
            self.assertTrue(popen.call_args.kwargs["start_new_session"])
            kill.assert_called_once_with(123456, OPERATOR.signal.SIGKILL)
            process.wait.assert_called_once_with(timeout=5)


if __name__ == "__main__":
    unittest.main()
