#!/usr/bin/env bash
# Publish a `review-evidence` commit status for one or more pull requests.
#
# WHY THIS EXISTS
# ---------------
# CodeRabbit is not a required check on this repo, and its own rate-limit check
# "passes by design so it never blocks merging on protected branches". So a PR
# that was never reviewed is indistinguishable, at the merge gate, from one that
# was reviewed and found clean. This status makes that distinction, and it is
# keyed to the CURRENT head SHA so a review of an earlier commit does not vouch
# for later pushes.
#
# WHAT COUNTS AS EVIDENCE
# -----------------------
# Four branches, evaluated in order, each keyed to the current head:
#   B1  bot-authored PR                      (CI gate applies separately)
#   B2  generated release PR                 (same-repo AND branch AND title)
#   A   formal review by an allowlisted bot  (CodeRabbit, online lane)
#   C   CLI review marker comment            (claude-kit cr-evidence.sh)
#   D   Claude review run in GitHub Actions  (.github/workflows/claude-review.yml)
# Anything else is `failure`. A branch that cannot answer publishes `error`
# rather than guessing — "could not determine" is never collapsed into "no".
#
# Branch D is additionally gated on the repo variable CLAUDE_REVIEW_GATE and is
# inert unless it reads exactly `authoritative`; see the branch for why absent
# must mean off.
#
# Ported from Sumit1993/mage-memory, where it has run since 2026-08-02. The
# repo-specific deltas are marked `PRISMALENS:` below. Tracked in #301.
#
# Usage:
#   REPO=owner/name ./review-evidence.sh 318 34      # specific PRs
#   REPO=owner/name ./review-evidence.sh --all-open  # sweeper
#   DRY_RUN=1 ...                                    # evaluate, publish nothing
set -uo pipefail

REPO="${REPO:?REPO must be set (owner/name)}"
STATUS_CONTEXT="${STATUS_CONTEXT:-review-evidence}"
DRY_RUN="${DRY_RUN:-0}"

# ---------------------------------------------------------------------------
# Policy constants.
#
# These live here, not in .github/governance.json or .coderabbit.yaml: the gate
# must not have to parse another tool's config format to learn its own policy,
# and a schema shared across repos is an API commitment that has not been earned
# yet (#301 — this is the second consumer; the reusable-workflow extraction is
# deliberately deferred until the third).
# ---------------------------------------------------------------------------

# Whose formal review counts as evidence. EXACT logins, never a substring match.
#
# This was `contains("coderabbit")`. On a public repo anyone can register an
# account whose name contains that string — `coderabbit-fan` — and a review from
# it would have satisfied the gate. An allowlist of exact bot logins closes that.
# `coderabbitai[bot]` is the real login, confirmed from live review payloads.
REVIEWER_LOGINS="${REVIEWER_LOGINS:-coderabbitai[bot]}"

# PR authors exempt from needing review evidence.
#
# This is not a hole: `CI gate` is separately a required check, so exempting these
# authors does not let unreviewed *code* merge. It lets machine-generated
# dependency bumps merge, which is the intent — nobody reviews them, and without
# this branch .github/workflows/dependabot-auto-merge.yml would be permanently
# blocked by a gate that can never go green.
#
# PRISMALENS: deliberately NOT widened to the CLA allowlist
# (.github/workflows/cla.yml lists `renovate[bot]` and `claude` too). Renovate is
# not installed on this repo, and `claude` is an agent account that writes real
# code — exactly what this gate exists to hold. An exemption that is not needed
# is just a hole.
BOT_AUTHORS="${BOT_AUTHORS:-dependabot[bot] github-actions[bot]}"

# Machine-generated PRs that are NOT bot-authored.
#
# PRISMALENS: this repo releases with changesets, not release-please, so both
# factors differ from the mage-memory original.
#
# `.github/workflows/release.yml` opens the Version Packages PR with RELEASE_PAT
# — a fine-grained PAT — precisely so the push comes from a user rather than
# `github-actions`. The consequence here is that the PR is authored by the PAT
# owner and is indistinguishable from a hand-written one by author alone, so B1
# above does not catch it. It also carries `Version Packages` in
# `.coderabbit.yaml`'s `ignore_title_keywords`, so it will never receive an
# online review either — without this branch it would sit red forever.
#
# THREE factors are required together. The label factor used upstream is
# unavailable — changesets/action applies no label and this repo declares none
# for releases — and the two that remain, branch name and title, are both
# attacker-settable on a FORK: anyone can open a PR from a branch named
# `changeset-release/main` titled `chore: version packages` and collect a free
# `success`. Upstream's label factor did not have that weakness, because applying
# a label requires write access. The same-repo check restores exactly that
# property, so it is not belt-and-braces — it is the load-bearing factor, and the
# other two are the ones that make it specific.
#
# The remaining two are fixed by `changesets/action` configuration in release.yml
# (`title:` and the action's own branch naming) and would not be produced
# incidentally. Given merges stay attended, that is enough here — but it is the
# softest branch in this gate, so it is deliberately narrow, and it fails CLOSED
# if release.yml's title ever drifts.
GENERATED_PR_BRANCH_RE="${GENERATED_PR_BRANCH_RE:-^changeset-release/}"
GENERATED_PR_TITLE_RE="${GENERATED_PR_TITLE_RE:-^chore: version packages$}"

# Marker left by a local CodeRabbit CLI review.
#
# Written by claude-kit's `cr-evidence.sh`, which `cr-preview.sh` calls after a
# successful CLI review (Sumit1993/claude-kit#6). Keyed to the head SHA, so
# evidence vouches for one commit and not for the PR: push again and it stops
# matching, and this gate goes red until the branch is re-previewed.
# Format:  <!-- cr-cli-review: <full head sha> -->
CLI_MARKER_PREFIX="${CLI_MARKER_PREFIX:-<!-- cr-cli-review:}"

# Comment authors whose CLI marker is trusted. An unauthenticated "evidence"
# comment from an arbitrary account must not satisfy the gate.
CLI_MARKER_AUTHORS="${CLI_MARKER_AUTHORS:-Sumit1993}"

# Marker left by a Claude review run in GitHub Actions.
#
# Written by the `marker` job of .github/workflows/claude-review.yml, which is
# gated behind `needs: review` so it cannot run unless the reviewing job
# succeeded. Keyed to the head SHA for the same reason as the CLI marker above:
# evidence vouches for one commit, not for the PR.
# Format:  <!-- claude-review: <full head sha> run:<run id> -->
CLAUDE_MARKER_PREFIX="${CLAUDE_MARKER_PREFIX:-<!-- claude-review:}"

# Comment authors whose Claude marker is trusted.
#
# `github-actions[bot]` is the workflow's OWN token — the only identity that can
# post from inside the two-job split, where the job holding the marker never
# reads PR content and the job that reads PR content never posts a marker. A
# human or an agent account that types this string by hand has been through
# neither half, so it must not satisfy the gate. Exact logins, never a substring
# match, for the same reason REVIEWER_LOGINS is an allowlist.
CLAUDE_MARKER_AUTHORS="${CLAUDE_MARKER_AUTHORS:-github-actions[bot]}"

# The workflow file a trusted Claude run must have come from.
#
# The marker names a run id; this is what that run has to BE. Without it, any
# successful run of any workflow on this repo at the right SHA — a doc build, a
# lint job — would satisfy branch D once its id appeared in a comment.
CLAUDE_REVIEW_WORKFLOW="${CLAUDE_REVIEW_WORKFLOW:-claude-review.yml}"

# ---------------------------------------------------------------------------

in_list () { # in_list <needle> <space-separated haystack>
  local needle="$1" hay="$2" item
  for item in $hay; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

# Publishing is a POST, and the statuses API appends rather than replaces: every
# call adds another row to the commit's status history. The sweeper re-evaluates
# every open PR on a schedule, so an unchanged verdict was being re-POSTed on
# every sweep — the history filled with identical entries, and the status
# timestamp advanced without the verdict ever changing, which makes "when did
# this last actually change" unanswerable from the API.
#
# So read the current status first and skip the write when nothing changed. Only
# an EXACT match on BOTH state and description is a no-op: same state with a
# different description is a real change (the `error` reasons differ), and must
# still be published.
#
# A read failure deliberately does NOT count as "unchanged" — it falls through to
# the POST. A redundant status is noise; a skipped one leaves a stale verdict on
# the gate, and this gate exists precisely to stop stale evidence from vouching
# for a current head.
publish () { # publish <sha> <state> <description>
  local sha="$1" state="$2" desc="${3:0:140}"
  if [ "$DRY_RUN" = "1" ]; then
    printf '    would publish: %s — %s\n' "$state" "$desc"
    return 0
  fi

  # The combined-status endpoint returns the MOST RECENT status per context, so
  # this is one request regardless of how long the history is.
  local current
  current=$(gh api "repos/$REPO/commits/$sha/status?per_page=100" 2>/dev/null \
            | jq -r --arg ctx "$STATUS_CONTEXT" '
                [ .statuses[] | select(.context == $ctx) ][0]
                | if . == null then empty else .state, (.description // "") end
              ' 2>/dev/null)
  if [ -n "$current" ] \
     && [ "$(sed -n 1p <<<"$current")" = "$state" ] \
     && [ "$(sed -n 2p <<<"$current")" = "$desc" ]; then
    printf '    unchanged: %s — %s (not re-published)\n' "$state" "$desc"
    return 0
  fi

  gh api -X POST "repos/$REPO/statuses/$sha" \
    -f state="$state" \
    -f context="$STATUS_CONTEXT" \
    -f description="$desc" \
    --silent || { echo "    ERROR: failed to publish status" >&2; return 1; }
  printf '    published: %s — %s\n' "$state" "$desc"
}

# Ask the API a question whose answer is a string, distinguishing THREE outcomes:
# a match, no match, and "could not tell". Conflating the last two is how a gate
# starts reporting confident answers it did not actually compute — the failure
# class this whole gate exists to prevent.
#   rc 0 = answered (value on stdout, may be empty for "no match")
#   rc 2 = could not determine
api_query () { # api_query <path> <jq filter> [jq args...]
  local path="$1" filter="$2"; shift 2
  local body
  # --paginate matters: a single page caps at 100. A long-lived PR accumulates
  # more than 100 comments, and the CLI evidence marker could fall off page one —
  # which would publish a false `failure` on a genuinely reviewed PR.
  body=$(gh api --paginate "$path" 2>/dev/null) || return 2
  # --paginate emits one array per page on older gh and a single merged array on
  # newer; `-s add` normalises both to one array.
  body=$(jq -s 'add // []' <<<"$body" 2>/dev/null) || return 2
  jq -r "$@" "$filter" <<<"$body" 2>/dev/null || return 2
}

evaluate_pr () { # evaluate_pr <number>
  local n="$1" pr sha author state draft head_ref head_repo title

  # A fetch failure is not "nothing to do" — it means we cannot evaluate, and the
  # caller must learn about it through the exit code rather than see a clean run.
  pr=$(gh api "repos/$REPO/pulls/$n" 2>/dev/null) || {
    echo "  PR #$n: cannot fetch — NOT evaluated" >&2; return 1; }

  sha=$(jq -r '.head.sha'      <<<"$pr")
  author=$(jq -r '.user.login' <<<"$pr")
  state=$(jq -r '.state'       <<<"$pr")
  draft=$(jq -r '.draft'       <<<"$pr")
  head_ref=$(jq -r '.head.ref' <<<"$pr")
  title=$(jq -r '.title'       <<<"$pr")
  # `// ""` matters: head.repo is null when the fork was deleted, and a null here
  # must not compare equal to $REPO.
  head_repo=$(jq -r '.head.repo.full_name // ""' <<<"$pr")

  printf '  PR #%s  head=%s  author=%s  branch=%s  state=%s  draft=%s\n' \
         "$n" "${sha:0:8}" "$author" "$head_ref" "$state" "$draft"

  if [ "$state" != "open" ]; then
    echo "    closed — not evaluated"; return 0
  fi

  # --- branch B1: bot-authored --------------------------------------------
  if in_list "$author" "$BOT_AUTHORS"; then
    publish "$sha" success "Bot-authored ($author); CI gate applies separately"
    return $?
  fi

  # --- branch B2: machine-generated release PR (same-repo AND branch AND title)
  if [ "$head_repo" = "$REPO" ] \
     && [[ "$head_ref" =~ $GENERATED_PR_BRANCH_RE ]] \
     && [[ "$title" =~ $GENERATED_PR_TITLE_RE ]]; then
    publish "$sha" success "Generated release PR ($head_ref); CI gate applies separately"
    return $?
  fi

  # --- branch A: a formal review AT THE CURRENT HEAD -----------------------
  # `commit_id` is the commit the review was actually made against, so this is
  # exact: a review of an earlier commit does not satisfy a later head.
  #
  # DISMISSED is excluded because dismissal is the explicit act of withdrawing a
  # review — treating a withdrawn review as evidence would let the gate vouch for
  # a verdict its author retracted. PENDING is an unsubmitted draft and is not a
  # verdict at all. Both are `state` values that survive on the review object, so
  # neither is filtered out by the commit_id match.
  local reviewer q_rc
  reviewer=$(api_query "repos/$REPO/pulls/$n/reviews?per_page=100" '
        ($logins | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.commit_id == $sha)
            | select(.state != "DISMISSED" and .state != "PENDING")
          ] | if length > 0 then .[-1].user.login else empty end' \
      --arg sha "$sha" --arg logins "$REVIEWER_LOGINS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi
  if [ -n "$reviewer" ]; then
    publish "$sha" success "Reviewed by $reviewer at ${sha:0:8}"
    return $?
  fi

  # --- branch C: CLI review marker for this head ---------------------------
  local marker_author
  marker_author=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
        ($authors | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.body | contains($pre + " " + $sha))
          ] | if length > 0 then .[-1].user.login else empty end' \
      --arg sha "$sha" --arg pre "$CLI_MARKER_PREFIX" --arg authors "$CLI_MARKER_AUTHORS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi
  if [ -n "$marker_author" ]; then
    publish "$sha" success "CLI review evidence from $marker_author at ${sha:0:8}"
    return $?
  fi

  # --- branch D: Claude review evidence for this head ----------------------
  #
  # Gated on the repo variable CLAUDE_REVIEW_GATE. The variable is created by
  # hand, starts at `shadow`, and only the operator flips it to `authoritative`
  # once the lane has been observed working end to end.
  #
  # ABSENT MUST MEAN INERT. The default is not "on": a variable that is missing,
  # unreadable, or holding any other value skips this branch entirely and falls
  # through to the failure below. If a missing variable granted authority, then
  # deleting it — or losing read access to it — would silently turn a gate
  # branch on rather than off, which is the wrong direction for every failure
  # mode this gate exists to catch.
  #
  # Reading it (and the Actions run below) needs `actions: read` on the caller's
  # token. Absent that, the read fails, branch D stays inert, and the gate keeps
  # behaving exactly as it did before this branch existed.
  local gate
  gate=$(gh api "repos/$REPO/actions/variables/CLAUDE_REVIEW_GATE" --jq '.value' 2>/dev/null) || gate=""
  if [ "$gate" = "authoritative" ]; then
    # Newest allowlisted comment carrying the prefix immediately followed by the
    # CURRENT head SHA, with its claimed run id extracted. A marker with no
    # `run:<id>` yields nothing here rather than erroring — a malformed marker is
    # not evidence, and it is not an API failure either.
    local claude_run_id
    claude_run_id=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
          ($authors | split(" ")) as $allowed
          | [ .[]
              | select(.user.login as $u | $allowed | index($u))
              | select(.body | contains($pre + " " + $sha))
            ]
          | if length > 0
            then (.[-1].body | capture("run:(?<id>[0-9]+)") | .id)
            else empty end' \
        --arg sha "$sha" --arg pre "$CLAUDE_MARKER_PREFIX" --arg authors "$CLAUDE_MARKER_AUTHORS")
    q_rc=$?
    if [ $q_rc -eq 2 ]; then
      publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
      return 1
    fi

    if [ -n "$claude_run_id" ]; then
      # The comment's own claim is NOT the evidence — the run is. A comment body
      # is just text, so `run:123` is an assertion by whoever wrote it; what makes
      # it evidence is that run 123 actually exists, actually succeeded, and
      # actually ran the review workflow against this exact commit.
      #
      # Four conditions, ALL required:
      #   status=completed + conclusion=success — a cancelled or failed run means
      #     the marker job was skipped by `needs`, so a marker alongside one is a
      #     forgery, not a race;
      #   head_sha == the PR's current head — closes replaying an old run's id
      #     under a new SHA;
      #   workflow path — closes citing an unrelated green run on this repo.
      #
      # The endswith is anchored on `/` so `not-claude-review.yml` cannot pass as
      # `claude-review.yml`; a plain suffix test would accept it.
      #
      # The runs endpoint is scoped to $REPO, so a run id from someone's fork
      # simply 404s here — a fetch failure is treated as no evidence, never as a
      # reason to publish success.
      local run_json verified=""
      run_json=$(gh api "repos/$REPO/actions/runs/$claude_run_id" 2>/dev/null) && \
        verified=$(jq -r --arg sha "$sha" --arg wf "$CLAUDE_REVIEW_WORKFLOW" '
            if (.status == "completed"
                and .conclusion == "success"
                and .head_sha == $sha
                and (.path // "" | endswith("/" + $wf)))
            then "ok" else "" end' <<<"$run_json" 2>/dev/null)

      if [ "$verified" = "ok" ]; then
        publish "$sha" success "Claude review evidence from run $claude_run_id at ${sha:0:8}"
        return $?
      fi
      # Marker present but the run does not back it up. Deliberately NOT an
      # `error`: we determined the answer, and the answer is that there is no
      # evidence. Fall through to the failure branch.
      echo "    claude marker cites run $claude_run_id, which does not verify — ignoring" >&2
    fi
  fi

  # --- no evidence ---------------------------------------------------------
  # Reached only when EVERY lookup answered successfully and none matched.
  publish "$sha" failure "No review evidence for ${sha:0:8} — silence is not a review"
  return $?
}

main () {
  local targets=()
  if [ "${1:-}" = "--all-open" ]; then
    echo "Sweeper: evaluating all open PRs in $REPO"
    # `mapfile < <(...)` hides the producer's exit status, so an API failure would
    # yield an empty list and report a clean "nothing to do". Capture separately.
    local listing
    listing=$(gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" --jq '.[].number' 2>/dev/null) || {
      echo "ERROR: cannot list open PRs — sweeper evaluated nothing" >&2; return 1; }
    [ -n "$listing" ] && mapfile -t targets <<<"$listing"
  else
    targets=("$@")
  fi

  if [ ${#targets[@]} -eq 0 ]; then echo "No PRs to evaluate."; return 0; fi

  local rc=0
  for n in "${targets[@]}"; do evaluate_pr "$n" || rc=1; done
  return $rc
}

main "$@"
