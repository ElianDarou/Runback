#!/usr/bin/env python3
"""Select affected CI jobs; unknown paths or an unavailable diff run all checks."""

import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = {"README.md", "AGENTS.md"}


def select_checks(paths):
    if paths is None:
        return {"android": True, "server": True}
    android = server = False
    for path in paths:
        if path in DOCUMENTS or path.startswith(("docs/", "site/", "tools/site-demo/")):
            continue
        if path.startswith("server/") or path == ".dockerignore":
            server = True
        elif path.startswith(("android/", "__tests__/")):
            android = True
        elif path.startswith("src/ui/") and path != "src/ui/components.tsx":
            android = True
        else:
            # Domain logic, native types, shared tokens, dependencies and CI affect
            # both consumers. New paths stay conservative until classified here.
            android = server = True
    return {"android": android, "server": server}


def changed_paths(root, event_name, event, sha):
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
    elif event_name == "push":
        base = event["before"]
    else:
        return None
    if not all(isinstance(ref, str) and re.fullmatch(r"[0-9a-f]{40}", ref)
               and ref != "0" * 40 for ref in (base, sha)):
        return None
    checked = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True,
                                      stderr=subprocess.PIPE).strip()
    if checked != sha:
        return None
    # Compare the checked PR merge against its base, or the entire push range.
    # Disabling rename detection includes both removed and added dependency paths.
    data = subprocess.check_output(
        ["git", "diff", "--no-renames", "--name-only", "-z", base, sha, "--"],
        cwd=root, stderr=subprocess.PIPE,
    )
    return [path.decode("utf-8") for path in data.split(b"\0") if path]


def main():
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        paths = changed_paths(ROOT, os.environ["GITHUB_EVENT_NAME"], event, os.environ["GITHUB_SHA"])
    except (KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError):
        paths = None
    checks = select_checks(paths)
    print(f"Changed paths: {len(paths) if paths is not None else 'unknown'}; checks: {checks}")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        for name, enabled in checks.items():
            handle.write(f"{name}={str(enabled).lower()}\n")


if __name__ == "__main__":
    main()
