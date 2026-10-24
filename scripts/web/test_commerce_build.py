import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("commerce_build", Path(__file__).with_name("build-commerce-review.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
REV = "a" * 40


class CommerceBuilder(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name).resolve()
        self.source = self.work / "source"
        self.source.mkdir()
        (self.work / "revision.txt").write_text(REV + "\n")
        (self.source / "fixture.txt").write_bytes(b"pinned source\n")
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as tree:
            info = tarfile.TarInfo("fixture.txt")
            info.size = len(b"pinned source\n")
            tree.addfile(info, io.BytesIO(b"pinned source\n"))
        self.archive = archive.getvalue()
        (self.work / "source.tar").write_bytes(self.archive)

    def verify(self):
        with patch.object(module.subprocess, "check_output", return_value=self.archive):
            module.verify_resume(self.work, self.source, REV)

    def test_resumes_exact_source_without_changing_it(self):
        before = (self.source / "fixture.txt").read_bytes()
        self.verify()
        self.assertEqual((self.source / "fixture.txt").read_bytes(), before)

    def test_rejects_changed_source_or_archive(self):
        (self.source / "fixture.txt").write_text("changed")
        with self.assertRaises(ValueError):
            self.verify()
        (self.source / "fixture.txt").write_bytes(b"pinned source\n")
        (self.work / "source.tar").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            self.verify()

    def test_rejects_wrong_revision_and_already_started_native_build(self):
        (self.work / "revision.txt").write_text("b" * 40)
        with self.assertRaises(ValueError):
            self.verify()
        (self.work / "revision.txt").write_text(REV)
        (self.work / "zallet").mkdir()
        with self.assertRaises(ValueError):
            self.verify()

    def test_rejects_source_file_symlink(self):
        (self.source / "fixture.txt").unlink()
        (self.source / "fixture.txt").symlink_to(self.work / "revision.txt")
        with self.assertRaises(ValueError):
            self.verify()

    def test_tooling_stays_outside_source_and_runtime_with_unique_containers(self):
        first = module.web_build_command(self.work, self.source, REV)
        second = module.web_build_command(self.work, self.source, REV)
        self.assertNotEqual(first[first.index("--name") + 1], second[second.index("--name") + 1])
        self.assertIn(str(self.work / "tooling") + ":/build-tools", first)
        self.assertIn("npm_config_cache=/build-tools/npm-cache", first)
        self.assertNotIn("npx", first[-1])
        self.assertIn("node /build-tools/node_modules/pnpm/bin/pnpm.cjs check", first[-1])
        self.assertIn("/build-tools/node_modules/.bin:$PATH", first[-1])
        self.assertIn("--ignore-scripts", first[-1])
        self.assertEqual((self.work / "tooling").stat().st_uid, os.getuid())
        self.assertNotIn("/preview", " ".join(first))
        self.assertNotIn("/wallets", " ".join(first))

    def test_native_resume_supplies_backup_fixture_to_tests_and_build(self):
        sdk = self.work / "zallet"
        modules = sdk / "zallet-core/examples/nostos_observer"
        modules.mkdir(parents=True)
        scripts = self.source / "scripts/lightclient"
        scripts.mkdir(parents=True)
        for name in ("storage", "transactions", "transaction_tests", "connection"):
            (scripts / (name + ".rs")).write_text(name)
            (modules / (name + ".rs")).write_text(name)
        for old, new in (("observer.rs", "nostos_observer/mod.rs"), ("worker.rs", "nostos_sdk_worker.rs"), ("observer_fixture.rs", "nostos_observer_fixture.rs")):
            (scripts / old).write_text(old)
            (modules.parent / new).write_text(old)
        native = self.work / "cache"
        binary = native / "build/target/release/examples/nostos_sdk_worker"
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"synthetic worker")
        with patch.object(module, "NATIVE", native), patch.object(module.subprocess, "check_output", return_value=module.PIN + "\n"), patch.object(module, "run") as runner:
            module.finish_native(self.work, self.source, REV)
            self.assertEqual(runner.call_count, 2)
            for call in runner.call_args_list:
                self.assertEqual(call.kwargs["env"]["NOSTOS_BACKUP_FIXTURE"], str(scripts / "backup_fixture.py"))
            self.assertTrue((self.work / "build-result.json").is_file())
            (modules / "connection.rs").write_text("changed")
            runner.reset_mock()
            with self.assertRaises(ValueError):
                module.finish_native(self.work, self.source, REV)
            runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
