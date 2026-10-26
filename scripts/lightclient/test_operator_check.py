"""All inputs are invented strings. No wallet/key fixtures or network use."""
import hashlib
import importlib.util
import json
from pathlib import Path
import os
import pty
import select
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name("operator-check.py")
SPEC = importlib.util.spec_from_file_location("operator_check", SCRIPT)
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class OperatorCheckTests(unittest.TestCase):
    def fake_binary(self, root, report, code=0, leak=False):
        path = Path(root) / "checker"
        path.write_text("#!/usr/bin/python3\nimport sys\n"
                        + ("sys.stderr.write(sys.stdin.read())\n" if leak else "")
                        + "print(" + repr(json.dumps(report)) + ")\n"
                        + "sys.exit(" + str(code) + ")\n")
        path.chmod(0o700)
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_fixed_success_and_failure_reports(self):
        with tempfile.TemporaryDirectory() as root:
            for passed in [True, False]:
                path, digest = self.fake_binary(root, CHECK.result(passed), 0 if passed else 1)
                self.assertEqual(CHECK.verified_binary(path, digest), str(path))
                self.assertEqual(CHECK.invoke(str(path), "invented-private-input", "invented-address"),
                                 CHECK.result(passed))

    def test_hash_symlink_and_writable_binary_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path, digest = self.fake_binary(root, CHECK.result(True))
            with self.assertRaises(ValueError):
                CHECK.verified_binary(path, "0" * 64)
            link = Path(root) / "link"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                CHECK.verified_binary(link, digest)
            path.chmod(0o777)
            with self.assertRaises(ValueError):
                CHECK.verified_binary(path, digest)

    def test_unexpected_child_output_never_becomes_a_report(self):
        with tempfile.TemporaryDirectory() as root:
            reports = [dict(CHECK.result(True), secret="invented-private-input"),
                       {**CHECK.result(True), "passed": "invented-private-input"},
                       {**CHECK.result(True), "passed": 1}]
            for report in reports:
                path, _ = self.fake_binary(root, report)
                with self.assertRaises(ValueError):
                    CHECK.invoke(str(path), "invented-private-input", "invented-address")

    def test_child_stderr_is_discarded(self):
        with tempfile.TemporaryDirectory() as root:
            path, _ = self.fake_binary(root, CHECK.result(True), leak=True)
            self.assertEqual(CHECK.invoke(str(path), "invented-private-input", "invented-address"),
                             CHECK.result(True))

    def test_non_terminal_refuses_before_consuming_private_input(self):
        completed = subprocess.run([sys.executable, str(SCRIPT), "/unused", "0" * 64],
                                   input="invented-private-input", text=True, capture_output=True)
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(json.loads(completed.stdout), CHECK.result(False))
        self.assertNotIn("invented-private-input", completed.stdout + completed.stderr)

    def test_real_terminal_prompts_do_not_echo_inputs_or_child_stderr(self):
        with tempfile.TemporaryDirectory() as root:
            path, digest = self.fake_binary(root, CHECK.result(True), leak=True)
            master, slave = pty.openpty()
            child = subprocess.Popen([sys.executable, str(SCRIPT), str(path), digest],
                                     stdin=slave, stdout=slave, stderr=slave)
            os.close(slave)
            output = b""
            def until(marker):
                nonlocal output
                deadline = time.monotonic() + 5
                while marker not in output:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not select.select([master], [], [], remaining)[0]:
                        self.fail("private terminal prompt timed out")
                    output += os.read(master, 4096)
            try:
                until(b"local memory only): ")
                os.write(master, b"invented-private-key\n")
                until(b"(hidden): ")
                os.write(master, b"invented-private-address\n")
                until(b'"passed": true')
                self.assertEqual(child.wait(timeout=5), 0)
                self.assertNotIn(b"invented-private", output)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()
                os.close(master)


if __name__ == "__main__":
    unittest.main()
