#!/usr/bin/env bash
# Fails on a merge-conflict marker line in any tracked file of the repo, naming each one:
# a merge committed mid-conflict once broke every build on the shared branch.
set -uo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 2
hits=$(git grep -nE '^(<{7}|={7}|>{7})( |$)' -- . ':!*.png' ':!*.jpg')
if [ -n "$hits" ]; then
	printf 'merge-conflict markers (resolve the merge, then commit):\n%s\n' "$hits"
	exit 1
fi
echo "merge markers: none"
