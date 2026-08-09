#!/usr/bin/env bash
# Replay the carry-forward rule against two real, known cases in this repo's
# history. Run by hand after touching `patch_identity` / `evidence_sha_ok` in
# review-evidence.sh; it needs `gh` authenticated and network access.
#
#   REPO=prismalens/prismalens ./.github/scripts/review-evidence-carryforward-replay.sh
#
# The two cases are the ones that motivated the rule (#301):
#
#   MUST CARRY  #366  27315a43 -> 69094554
#     A merge-from-main that changed no file the PR touches. This discarded a
#     complete CodeRabbit review and the PR was merged under an admin bypass
#     instead. The rule exists to stop exactly this.
#
#   MUST NOT    #392  38036ac -> 02f024a
#     Real edits between the two commits, made in response to a review finding
#     (a missing row in the workflow inventory). Those reviews were not waste —
#     they were different diffs, and a rule that carried this forward would be
#     vouching for code nobody read.
#
#     The first pair considered here was 106a52e -> 38036ac, which is the more
#     literal retelling. It cannot be used: 106a52e was amended away before the
#     branch was ever pushed, so the compare API answers 422 and the test would
#     report INCONCLUSIVE forever. Both SHAs in a replay must exist on the remote.
#
# A rule that passes only the first test is useless; one that passes only the
# second is dangerous. Both must pass.
set -uo pipefail

REPO="${REPO:?REPO must be set (owner/name)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pull in patch_identity without running the evaluator: main() is invoked at the
# bottom of that file, so it is read up to the entrypoint and no further.
# shellcheck disable=SC1090
source <(sed '/^main "\$@"$/d' "$SCRIPT_DIR/review-evidence.sh")

fail=0

check () { # check <label> <base> <sha_a> <sha_b> <expect: same|differ>
  local label="$1" base="$2" a="$3" b="$4" expect="$5"
  local id_a id_b verdict

  id_a=$(patch_identity "$base" "$a") || id_a=""
  id_b=$(patch_identity "$base" "$b") || id_b=""

  if [ -z "$id_a" ] || [ -z "$id_b" ]; then
    printf 'INCONCLUSIVE  %s\n              could not compute a patch-id (a=%s b=%s)\n' \
           "$label" "${id_a:-none}" "${id_b:-none}"
    fail=1
    return
  fi

  if [ "$id_a" = "$id_b" ]; then verdict=same; else verdict=differ; fi

  if [ "$verdict" = "$expect" ]; then
    printf 'PASS  %s\n      expected %s, got %s\n      %s -> %s\n      %s -> %s\n' \
           "$label" "$expect" "$verdict" "${a:0:8}" "${id_a:0:12}" "${b:0:8}" "${id_b:0:12}"
  else
    printf 'FAIL  %s\n      expected %s, got %s\n      %s -> %s\n      %s -> %s\n' \
           "$label" "$expect" "$verdict" "${a:0:8}" "${id_a:0:12}" "${b:0:8}" "${id_b:0:12}"
    fail=1
  fi
}

echo "Replaying carry-forward against $REPO"
echo

check "#366 merge-from-main must carry evidence forward" \
      main \
      27315a43a05346e902d278f00538098b5a8d4fb6 \
      69094554ae61aea6c1f61b08e411adb20d370f13 \
      same

echo

check "#392 real edits must NOT carry evidence forward" \
      main \
      38036ac8d8e8323af309295dc215d175ee635b48 \
      02f024ada88750f27175fe5084331e8cc410741b \
      differ

echo
if [ "$fail" -eq 0 ]; then
  echo "All carry-forward replays passed."
else
  echo "Carry-forward replay FAILED — do not ship." >&2
fi
exit "$fail"
