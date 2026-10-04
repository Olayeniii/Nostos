import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('auto_deploy', Path(__file__).with_name('auto-deploy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DeploymentGate(unittest.TestCase):
    def test_changed_commit_allowed_but_failed_same_commit_held(self):
        sha = 'a' * 40
        self.assertTrue(module.eligible('b' * 40, sha, '', 'main', {}))
        self.assertFalse(module.eligible('b' * 40, sha, '', 'main', {'attempt': sha, 'status': 'failed'}))
        self.assertTrue(module.eligible(sha, 'c' * 40, '', 'main', {'attempt': sha}))

    def test_local_changes_other_branch_or_bad_revision_blocked(self):
        for dirty, branch, target in [(' M file', 'main', 'a'*40), ('', 'work', 'a'*40), ('', 'main', 'bad')]:
            self.assertFalse(module.eligible('b'*40, target, dirty, branch, {}))
