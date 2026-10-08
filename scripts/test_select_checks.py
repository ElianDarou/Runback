import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("selection", Path(__file__).with_name("select-checks.py"))
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


class SelectionTests(unittest.TestCase):
    def test_documents_and_site_do_not_build_apps_or_server(self):
        self.assertEqual(selection.select_checks([
            "README.md", "AGENTS.md", "docs/spec.md", "site/en.html",
            "site/shots/export.webp", "tools/site-demo/gen.py",
        ]), {"android": False, "server": False})

    def test_app_and_server_changes_are_independent(self):
        for paths, expected in (
            (["android/core/src/main/Test.kt"], {"android": True, "server": False}),
            (["src/ui/WorkoutScreen.tsx", "__tests__/workoutScreen.test.tsx"],
             {"android": True, "server": False}),
            (["server/package-lock.json", ".dockerignore"], {"android": False, "server": True}),
            (["server/src/app.ts", "android/wear/build.gradle"], {"android": True, "server": True}),
        ):
            with self.subTest(paths=paths):
                self.assertEqual(selection.select_checks(paths), expected)

    def test_shared_inputs_ci_and_unknown_paths_run_both(self):
        for path in ("src/domain/strength.ts", "src/native.ts", "src/ui/components.tsx",
                     "package.json", "package-lock.json", "tsconfig.json", "jest.config.js",
                     "babel.config.js", ".github/workflows/android.yml", "scripts/select-checks.py",
                     "new-module/index.ts"):
            with self.subTest(path=path):
                self.assertEqual(selection.select_checks(["site/index.html", path]),
                                 {"android": True, "server": True})

    def test_manual_unknown_and_invalid_ranges_run_both(self):
        for name, event, sha in (
            ("workflow_dispatch", {}, "a" * 40), ("other", {}, "a" * 40),
            ("push", {"before": "0" * 40}, "a" * 40),
            ("push", {"before": "--invalid"}, "a" * 40),
            ("push", {"before": "a" * 40}, "--invalid"),
        ):
            with self.subTest(name=name, event=event):
                paths = selection.changed_paths(Path("."), name, event, sha)
                self.assertEqual(selection.select_checks(paths), {"android": True, "server": True})

    def test_missing_event_or_git_history_runs_both(self):
        for contents in ("{", "{}", json.dumps({"before": "a" * 40})):
            with self.subTest(contents=contents), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / "event.json").write_text(contents)
                env = {"GITHUB_EVENT_NAME": "push", "GITHUB_EVENT_PATH": str(root / "event.json"),
                       "GITHUB_SHA": "b" * 40, "GITHUB_OUTPUT": str(root / "outputs")}
                with patch.dict(os.environ, env, clear=True), patch.object(selection, "ROOT", root):
                    selection.main()
                self.assertEqual((root / "outputs").read_text(), "android=true\nserver=true\n")


class GitRangeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.git("init", "-q", "--initial-branch=main")
        self.git("config", "user.email", "ci@example.invalid")
        self.git("config", "user.name", "CI test")
        self.base = self.commit("README.md")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE,
                                       text=True).strip()

    def commit(self, path):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(path)
        self.git("add", ".")
        self.git("commit", "-qm", "test")
        return self.git("rev-parse", "HEAD")

    def test_push_checks_all_commits_not_only_the_last_one(self):
        self.commit("android/core/changed.kt")
        head = self.commit("site/index.html")
        paths = selection.changed_paths(self.root, "push", {"before": self.base}, head)
        self.assertEqual(selection.select_checks(paths), {"android": True, "server": False})

    def test_pr_diff_uses_checked_merge_against_current_base(self):
        self.git("checkout", "-qb", "pr")
        self.commit("site/index.html")
        self.git("checkout", "-q", "main")
        base = self.commit("android/core/base-change.kt")
        self.git("merge", "--no-ff", "-qm", "checked merge", "pr")
        head = self.git("rev-parse", "HEAD")
        paths = selection.changed_paths(self.root, "pull_request", {"pull_request": {"base": {"sha": base}}}, head)
        self.assertEqual(paths, ["site/index.html"])

    def test_renames_and_deletions_keep_original_dependencies(self):
        base = self.commit("src/domain/removed.ts")
        # Identical contents must still flag removal from the shared domain.
        (self.root / "site").mkdir(exist_ok=True)
        self.git("mv", "src/domain/removed.ts", "site/moved.ts")
        self.git("commit", "-qm", "move shared file")
        head = self.git("rev-parse", "HEAD")
        paths = selection.changed_paths(self.root, "push", {"before": base}, head)
        self.assertEqual(set(paths), {"src/domain/removed.ts", "site/moved.ts"})
        self.assertEqual(selection.select_checks(paths), {"android": True, "server": True})

    def test_checkout_mismatch_does_not_skip_checks(self):
        self.commit("site/index.html")
        paths = selection.changed_paths(self.root, "push", {"before": self.base}, self.base)
        self.assertIsNone(paths)


if __name__ == "__main__":
    unittest.main()
