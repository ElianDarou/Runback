#!/usr/bin/env python3
"""Reuse a successful, identical PR build; uncertainty always means a fresh build."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ".github/workflows/android.yml"
REQUIRED_JOBS = {"Check self-hosted server and Docker image", "Check and build phone + Wear OS"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(path, binary=False):
    data = subprocess.check_output(["gh", "api", path], timeout=90, stderr=subprocess.PIPE)
    return data if binary else json.loads(data)


def eligible_run(run, current, pull, repository):
    return (
        run["workflow_id"] == current["workflow_id"]
        and run["path"] == WORKFLOW
        and run["event"] == "pull_request"
        and run["status"] == "completed" and run["conclusion"] == "success"
        and run["head_repository"]["full_name"] == repository
        and run["head_sha"] == pull["head"]["sha"]
        and run["run_number"] < current["run_number"]
    )


def verified_assets(archive_bytes, run, tree, commit_lookup):
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate artifact files")
        require(len(names) == 5 and {"BUILD-METADATA.json", "SHA256SUMS", "RELEASE-NOTES.md"}.issubset(names),
                "Incomplete release artifact")
        require(all(Path(name).name == name for name in names), "Unexpected artifact paths")
        assets = {name: archive.read(name) for name in names}
    metadata = json.loads(assets["BUILD-METADATA.json"])
    require(metadata["tree"] == tree, "Checked repository contents differ")
    require(str(metadata["ciRun"]) == str(run["id"]), "Wrong source run")
    require(str(metadata["ciAttempt"]) == str(run["run_attempt"]), "Wrong source attempt")
    require(metadata["versionCode"] == run["run_number"], "Wrong APK version code")
    version = f"0.1.{run['run_number']}"
    require(metadata["versionName"] == version, "Wrong APK version name")
    require(metadata["publicTestKey"] is True, "Missing test signature verification")
    commit = metadata["commit"]
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Invalid checked commit")
    checked = commit_lookup(commit)
    require(checked["tree"]["sha"] == tree, "Checked commit has a different tree")
    # PR runs usually check GitHub's synthetic merge, not the branch head.
    require(commit == run["head_sha"] or
            (len(checked["parents"]) == 2 and checked["parents"][1]["sha"] == run["head_sha"]),
            "Checked commit does not belong to the PR run")
    expected = {"BUILD-METADATA.json"}
    require(set(metadata["apps"]) == {"phone", "wear"}, "Missing app metadata")
    for role, app in metadata["apps"].items():
        filename = f"runback-{role}-{version}-{commit[:8]}.apk"
        require(app["file"] == filename and filename in assets, "Missing APK")
        require(app["versionCode"] == run["run_number"] and app["versionName"] == version,
                "APK metadata version differs")
        require(app["applicationId"] == "com.runback", "Wrong app identity")
        require(re.fullmatch(r"[0-9a-f]{64}", app["certificateSha256"]), "Missing signing certificate")
        expected.add(filename)
    require(metadata["apps"]["phone"]["certificateSha256"] == metadata["apps"]["wear"]["certificateSha256"],
            "App signing certificates differ")
    require({"arm64-v8a", "armeabi-v7a", "x86_64"}.issubset(metadata["apps"]["phone"]["abis"]),
            "Missing phone architectures")
    sums = {}
    for line in assets["SHA256SUMS"].decode("utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([^/\\]+)", line)
        require(match is not None and match[2] not in sums, "Invalid checksums")
        sums[match[2]] = match[1]
    require(set(sums) == expected, "Checksums do not cover the release assets")
    require(set(names) == expected | {"SHA256SUMS", "RELEASE-NOTES.md"}, "Unexpected release files")
    for name, digest in sums.items():
        require(hashlib.sha256(assets[name]).hexdigest() == digest, "Artifact checksum mismatch")
    return assets, metadata


def find_reusable_build(repository, sha, current, tree, fetch=None):
    fetch = fetch or api
    prefix = f"repos/{repository}"
    pulls = fetch(f"{prefix}/commits/{sha}/pulls?per_page=100")
    for pull in pulls:
        if not (pull["merged_at"] and pull["merge_commit_sha"] == sha
                and pull["base"]["ref"] == "main"
                and pull["base"]["repo"]["full_name"] == repository
                and pull["head"]["repo"] and pull["head"]["repo"]["full_name"] == repository):
            continue
        runs = fetch(f"{prefix}/actions/workflows/{current['workflow_id']}/runs"
                     f"?event=pull_request&head_sha={pull['head']['sha']}&per_page=100")
        require(runs["total_count"] <= 100, "Too many source runs to establish provenance")
        for run in sorted(runs["workflow_runs"], key=lambda item: item["run_number"], reverse=True):
            if not eligible_run(run, current, pull, repository):
                continue
            # Keep Android updates monotonic, including prior failed/queued main runs.
            main_runs = fetch(f"{prefix}/actions/workflows/{current['workflow_id']}/runs"
                              f"?event=push&branch=main&created=%3E%3D{run['created_at']}&per_page=100")
            require(main_runs["total_count"] <= 100, "Cannot establish APK version order")
            if any(item["id"] != current["id"] and
                   run["run_number"] <= item["run_number"] < current["run_number"]
                   for item in main_runs["workflow_runs"]):
                continue
            jobs = fetch(f"{prefix}/actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs?per_page=100")
            require(jobs["total_count"] <= 100, "Cannot establish completed checks")
            passed = {job["name"] for job in jobs["jobs"]
                      if job["status"] == "completed" and job["conclusion"] == "success"}
            if not REQUIRED_JOBS.issubset(passed):
                continue
            artifacts = fetch(f"{prefix}/actions/runs/{run['id']}/artifacts?per_page=100")
            name = f"runback-apks-{run['run_number']}-{run['run_attempt']}"
            matches = [item for item in artifacts["artifacts"] if item["name"] == name and not item["expired"]]
            if len(matches) != 1:
                continue
            archive = fetch(f"{prefix}/actions/artifacts/{matches[0]['id']}/zip", binary=True)
            assets, metadata = verified_assets(archive, run, tree,
                                               lambda commit: fetch(f"{prefix}/git/commits/{commit}"))
            return assets, metadata
    return None


def prepare_release(assets, metadata, sha, current_id, output):
    # Preserve build provenance and embedded APK versions; only release metadata changes.
    metadata = {**metadata, "releaseCommit": sha, "releaseCiRun": str(current_id)}
    assets = {**assets, "BUILD-METADATA.json": (json.dumps(metadata, indent=2) + "\n").encode()}
    assets["SHA256SUMS"] = "".join(
        f"{hashlib.sha256(assets[name]).hexdigest()}  {name}\n"
        for name in sorted(assets) if name.endswith(".apk") or name == "BUILD-METADATA.json"
    ).encode()
    assets["RELEASE-NOTES.md"] += (
        f"\nFür Main-Commit `{sha}` aus dem erfolgreichen PR-Lauf `{metadata['ciRun']}` übernommen. "
        f"Der vollständige Repository-Inhalt ist identisch (`{metadata['tree']}`). "
        "APKs und ihre Versionsnummer bleiben unverändert.\n"
    ).encode()
    output.mkdir()
    for name, data in assets.items():
        (output / name).write_bytes(data)


def main():
    result = {"reuse": "false"}
    output = ROOT / "dist"
    if os.environ.get("GITHUB_EVENT_NAME") == "push" and os.environ.get("GITHUB_REF") == "refs/heads/main":
        try:
            repository, sha = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]
            current = api(f"repos/{repository}/actions/runs/{os.environ['GITHUB_RUN_ID']}")
            tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip()
            require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() == sha,
                    "Checkout does not match the merged commit")
            found = find_reusable_build(repository, sha, current, tree)
            if found:
                assets, metadata = found
                prepare_release(assets, metadata, sha, current["id"], output)
                result = {"reuse": "true", "version": metadata["versionName"],
                          "tag": f"test-{metadata['versionName']}-{sha[:8]}",
                          "artifact": f"reused-apks-{current['run_number']}-{current['run_attempt']}"}
                print(f"Reuse verified PR run {metadata['ciRun']}; identical tree {tree}.")
            else:
                print("No reusable PR build; run all checks and build fresh APKs.")
        except (KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile):
            # Missing API permissions, old metadata and expired artifacts are cache misses.
            if output.exists():
                shutil.rmtree(output)
            print("Reuse could not be verified; run all checks and build fresh APKs.")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        for key, value in result.items():
            handle.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
