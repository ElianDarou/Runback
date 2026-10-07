import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("reuse", Path(__file__).with_name("reuse-pr-build.py"))
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)

REPO = "GhostCodeByte/Runback"
HEAD, CHECKED, MERGED, TREE = "a" * 40, "b" * 40, "c" * 40, "d" * 40


def archive(assets):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as handle:
        for name, data in assets.items():
            handle.writestr(name, data)
    return output.getvalue()


def with_checksums(assets):
    return {**assets, "SHA256SUMS": "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n"
        for name, data in assets.items() if name.endswith(".apk") or name == "BUILD-METADATA.json"
    ).encode()}


class ReuseTests(unittest.TestCase):
    def setUp(self):
        self.current = {"id": 200, "workflow_id": 7, "run_number": 20, "run_attempt": 1}
        self.run = {"id": 190, "workflow_id": 7, "run_number": 19, "run_attempt": 2,
                    "path": reuse.WORKFLOW, "head_sha": HEAD, "head_repository": {"full_name": REPO},
                    "event": "pull_request", "status": "completed", "conclusion": "success",
                    "created_at": "2026-10-07T10:00:00Z"}
        self.pull = {"merged_at": "2026-10-07T11:00:00Z", "merge_commit_sha": MERGED,
                     "base": {"ref": "main", "repo": {"full_name": REPO}},
                     "head": {"sha": HEAD, "repo": {"full_name": REPO}}}
        self.checked = {"tree": {"sha": TREE}, "parents": [{"sha": "e" * 40}, {"sha": HEAD}]}
        self.metadata = {"commit": CHECKED, "tree": TREE, "ciRun": "190", "ciAttempt": "2",
                         "versionCode": 19, "versionName": "0.1.19", "publicTestKey": True, "apps": {}}
        self.assets = {"RELEASE-NOTES.md": b"Original checked build\n"}
        for role in ("phone", "wear"):
            filename = f"runback-{role}-0.1.19-{CHECKED[:8]}.apk"
            self.assets[filename] = f"unchanged {role} APK".encode()
            self.metadata["apps"][role] = {
                "file": filename, "versionCode": 19, "versionName": "0.1.19", "applicationId": "com.runback",
                "certificateSha256": "f" * 64, "abis": ["arm64-v8a", "armeabi-v7a", "x86_64"]}
        self.main_runs = [self.current]
        self.jobs = [{"name": name, "status": "completed", "conclusion": "success"}
                     for name in reuse.REQUIRED_JOBS]
        self.artifacts = [{"id": 88, "name": "runback-apks-19-2", "expired": False}]
        self.calls = []

    def packed(self):
        return archive(with_checksums({**self.assets, "BUILD-METADATA.json": json.dumps(self.metadata).encode()}))

    def fetch(self, path, binary=False):
        self.calls.append(path)
        if path == f"repos/{REPO}/actions/runs/{self.current['id']}":
            return self.current
        if "/commits/" in path and "/pulls?" in path:
            return [self.pull]
        if "event=pull_request" in path:
            return {"total_count": 1, "workflow_runs": [self.run]}
        if "event=push" in path:
            return {"total_count": len(self.main_runs), "workflow_runs": self.main_runs}
        if "/jobs?" in path:
            return {"total_count": len(self.jobs), "jobs": self.jobs}
        if "/artifacts?" in path:
            return {"artifacts": self.artifacts}
        if path.endswith("/zip"):
            self.assertTrue(binary)
            return self.packed()
        if "/git/commits/" in path:
            return self.checked
        raise AssertionError(path)

    def find(self):
        return reuse.find_reusable_build(REPO, MERGED, self.current, TREE, self.fetch)

    def test_identical_successful_pr_and_latest_attempt_are_reused(self):
        assets, metadata = self.find()
        self.assertEqual(metadata["versionCode"], 19)
        self.assertEqual(assets["RELEASE-NOTES.md"], self.assets["RELEASE-NOTES.md"])
        self.assertTrue(any("/attempts/2/jobs" in path for path in self.calls))

    def test_unsuccessful_incomplete_or_foreign_runs_are_not_reused(self):
        for changes in ({"conclusion": "failure"}, {"status": "in_progress"},
                        {"workflow_id": 8}, {"event": "push"}, {"path": "other.yml"},
                        {"head_sha": "f" * 40}, {"head_repository": {"full_name": "fork/Runback"}}):
            with self.subTest(changes=changes):
                run = {**self.run, **changes}
                self.assertFalse(reuse.eligible_run(run, self.current, self.pull, REPO))

    def test_only_the_actual_merged_pr_from_this_repository_is_used(self):
        original = copy.deepcopy(self.pull)
        for changes in ({"merged_at": None}, {"merge_commit_sha": HEAD},
                        {"head": {"sha": HEAD, "repo": {"full_name": "fork/Runback"}}},
                        {"base": {"ref": "other", "repo": {"full_name": REPO}}}):
            with self.subTest(changes=changes):
                self.pull = {**original, **changes}
                self.assertIsNone(self.find())

    def test_changed_tree_or_unrelated_commit_is_rejected(self):
        for checked in ({"tree": {"sha": "e" * 40}, "parents": self.checked["parents"]},
                        {"tree": {"sha": TREE}, "parents": [{"sha": "f" * 40}]}):
            with self.subTest(checked=checked), self.assertRaises(ValueError):
                reuse.verified_assets(self.packed(), self.run, TREE, lambda _: checked)
        self.metadata["tree"] = "e" * 40
        with self.assertRaises(ValueError):
            self.find()

    def test_missing_or_failed_server_and_build_checks_require_fresh_build(self):
        for missing in reuse.REQUIRED_JOBS:
            with self.subTest(missing=missing):
                self.jobs = [{"name": name, "status": "completed", "conclusion": "failure" if name == missing else "success"}
                             for name in reuse.REQUIRED_JOBS]
                self.assertIsNone(self.find())
        self.jobs = []
        self.assertIsNone(self.find())

    def test_missing_expired_and_old_attempt_artifacts_require_fresh_build(self):
        for artifacts in ([], [{"id": 88, "name": "runback-apks-19-2", "expired": True}],
                          [{"id": 88, "name": "runback-apks-19-1", "expired": False}]):
            with self.subTest(artifacts=artifacts):
                self.artifacts = artifacts
                self.assertIsNone(self.find())

    def test_version_order_blocks_an_older_apk_after_another_main_run(self):
        self.run["run_number"] = 18
        self.main_runs.append({"id": 195, "run_number": 19})
        self.assertIsNone(self.find())

    def test_old_metadata_wrong_attempt_and_wrong_version_are_rejected(self):
        original = copy.deepcopy(self.metadata)
        for changes in ({"ciRun": "189"}, {"ciAttempt": "1"}, {"versionCode": 18},
                        {"versionName": "0.1.18"}, {"publicTestKey": False}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.metadata = {**original, **changes}
                self.find()
        self.metadata = original
        del self.metadata["tree"]
        with self.assertRaises(KeyError):
            self.find()

    def test_corrupted_incomplete_or_unsafe_artifact_is_rejected(self):
        assets = with_checksums({**self.assets, "BUILD-METADATA.json": json.dumps(self.metadata).encode()})
        phone = self.metadata["apps"]["phone"]["file"]
        for damaged in ({**assets, phone: b"corrupted"},
                        {name: data for name, data in assets.items() if name != phone},
                        {**assets, "../outside": b"unsafe"}):
            with self.subTest(files=list(damaged)), self.assertRaises(ValueError):
                reuse.verified_assets(archive(damaged), self.run, TREE, lambda _: self.checked)

    def test_release_keeps_apks_and_build_provenance_and_records_main_commit(self):
        assets, metadata = self.find()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "dist"
            reuse.prepare_release(assets, metadata, MERGED, 200, output)
            released = json.loads((output / "BUILD-METADATA.json").read_text())
            self.assertEqual(released["commit"], CHECKED)
            self.assertEqual(released["ciRun"], "190")
            self.assertEqual(released["versionCode"], 19)
            self.assertEqual(released["releaseCommit"], MERGED)
            for app in metadata["apps"].values():
                self.assertEqual((output / app["file"]).read_bytes(), assets[app["file"]])
            for line in (output / "SHA256SUMS").read_text().splitlines():
                digest, name = line.split("  ")
                self.assertEqual(digest, hashlib.sha256((output / name).read_bytes()).hexdigest())

    def test_api_failure_falls_back_without_reuse_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": REPO,
                   "GITHUB_SHA": MERGED, "GITHUB_RUN_ID": "200", "GITHUB_OUTPUT": str(root / "outputs")}
            with patch.dict(os.environ, env, clear=True), patch.object(reuse, "ROOT", root), \
                    patch.object(reuse, "api", side_effect=OSError("API unavailable")):
                reuse.main()
            self.assertEqual((root / "outputs").read_text(), "reuse=false\n")
            self.assertFalse((root / "dist").exists())

    def test_main_only_emits_reuse_after_verifying_and_preparing_all_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": REPO,
                   "GITHUB_SHA": MERGED, "GITHUB_RUN_ID": "200", "GITHUB_OUTPUT": str(root / "outputs")}
            with patch.dict(os.environ, env, clear=True), patch.object(reuse, "ROOT", root), \
                    patch.object(reuse, "api", side_effect=self.fetch), \
                    patch.object(reuse.subprocess, "check_output", side_effect=[TREE, MERGED]):
                reuse.main()
            outputs = dict(line.split("=", 1) for line in (root / "outputs").read_text().splitlines())
            self.assertEqual(outputs, {"reuse": "true", "version": "0.1.19",
                                      "tag": f"test-0.1.19-{MERGED[:8]}", "artifact": "reused-apks-20-1"})
            self.assertEqual(len(list((root / "dist").iterdir())), 5)

    def test_main_changed_contents_or_download_failure_falls_back(self):
        for tree in (TREE, "f" * 40):
            with self.subTest(tree=tree), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": REPO,
                       "GITHUB_SHA": MERGED, "GITHUB_RUN_ID": "200", "GITHUB_OUTPUT": str(root / "outputs")}
                def fetch(path, binary=False):
                    if tree == TREE and binary:
                        raise OSError("Artifact no longer available")
                    return self.fetch(path, binary)
                with patch.dict(os.environ, env, clear=True), patch.object(reuse, "ROOT", root), \
                        patch.object(reuse, "api", side_effect=fetch), \
                        patch.object(reuse.subprocess, "check_output", side_effect=[tree, MERGED]):
                    reuse.main()
                self.assertEqual((root / "outputs").read_text(), "reuse=false\n")
                self.assertFalse((root / "dist").exists())

    def test_pr_and_manual_runs_never_reuse(self):
        for event in ("pull_request", "workflow_dispatch"):
            with self.subTest(event=event), tempfile.TemporaryDirectory() as folder:
                output = Path(folder) / "outputs"
                with patch.dict(os.environ, {"GITHUB_EVENT_NAME": event, "GITHUB_OUTPUT": str(output)}, clear=True), \
                        patch.object(reuse, "api") as fetch:
                    reuse.main()
                    fetch.assert_not_called()
                self.assertEqual(output.read_text(), "reuse=false\n")


if __name__ == "__main__":
    unittest.main()
