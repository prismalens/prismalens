"""
Search for files changed in a GitHub repository within a time window.

Usage: python3 search-recent-changes.py

Requires env vars: GITHUB_API_KEY, GITHUB_BASE_URL
Adapt OWNER, REPO, and TIME_WINDOW for the current investigation.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

# Configuration — adapt for the current investigation
OWNER = ""  # e.g., "prismalens-org"
REPO = ""   # e.g., "prismalens"
TIME_WINDOW_HOURS = 24
BRANCH = "main"

token = os.environ.get("GITHUB_API_KEY", "")
base_url = os.environ.get("GITHUB_BASE_URL", "https://api.github.com")

if not token:
    print(json.dumps({"error": "GITHUB_API_KEY not set"}))
    sys.exit(1)

if not OWNER or not REPO:
    print(json.dumps({"error": "OWNER and REPO must be configured — edit this script"}))
    sys.exit(1)

since = (datetime.now(timezone.utc) - timedelta(hours=TIME_WINDOW_HOURS)).isoformat()

# Fetch recent commits
url = f"{base_url}/repos/{OWNER}/{REPO}/commits?sha={BRANCH}&since={since}&per_page=100"
req = urllib.request.Request(url, headers={
    "Authorization": f"Bearer {token}",
    "Accept": "application/vnd.github+json",
})

try:
    commits = json.loads(urllib.request.urlopen(req).read())
except Exception as e:
    print(json.dumps({"error": f"Failed to fetch commits: {e}"}))
    sys.exit(1)

# Aggregate changed files across all commits
changed_files = {}
for commit in commits:
    sha = commit["sha"]
    detail_url = f"{base_url}/repos/{OWNER}/{REPO}/commits/{sha}"
    detail_req = urllib.request.Request(detail_url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
    })
    try:
        detail = json.loads(urllib.request.urlopen(detail_req).read())
        for f in detail.get("files", []):
            filename = f["filename"]
            if filename not in changed_files:
                changed_files[filename] = {"changes": 0, "commits": []}
            changed_files[filename]["changes"] += f.get("changes", 0)
            changed_files[filename]["commits"].append(sha[:8])
    except Exception:
        continue

# Sort by most changes
sorted_files = sorted(changed_files.items(), key=lambda x: x[1]["changes"], reverse=True)

print(json.dumps({
    "total_commits": len(commits),
    "total_files_changed": len(changed_files),
    "time_window": f"last {TIME_WINDOW_HOURS} hours",
    "most_changed_files": [
        {"file": f, "changes": d["changes"], "commits": d["commits"]}
        for f, d in sorted_files[:20]
    ],
}, indent=2))
