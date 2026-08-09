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
# B1 and B2 do NOT apply on a high-risk path — see the independence rule.
#   A   formal review by an allowlisted bot  (CodeRabbit, online lane)
#   D   Claude review marker + its run       (.github/workflows/claude-code-review.yml)
# Anything else is `failure`. A branch that cannot answer publishes `error`
# rather than guessing — "could not determine" is never collapsed into "no".
#
# A and D both accept a patch-identical earlier commit; see CARRY_FORWARD.
#
# `claude[bot]` is NOT in REVIEWER_LOGINS and must not be added — that login is
# shared with the `@claude` mention lane, so branch A cannot tell a review of the
# diff from a post anyone could summon. Claude evidence goes through D.
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
#
# SPACE-separated, not comma: branch A splits this on " ". A comma-joined value
# parses as one login that matches nobody, which fails closed — every PR red —
# but only once a second login exists, which is why it survived a single-entry
# default.
#
# `claude[bot]` is DELIBERATELY ABSENT, and must not be added. It is an app
# installation shared by claude-code-review.yml and claude.yml, the mention lane
# anyone who can comment may trigger — so the login does not establish who
# produced the artifact. Claude evidence arrives through branch D's marker
# instead, which is authored by a job the reviewing agent holds no credential to
# impersonate. An earlier design allowlisted the login here and tried to bind it
# by timestamp against a successful run; that made a successful run a reusable
# authorization token, because a run that succeeds while posting nothing leaves
# the authorization unspent for a mention-lane post to redeem. See branch D.
REVIEWER_LOGINS="${REVIEWER_LOGINS:-coderabbitai[bot]}"

# PR authors exempt from needing review evidence.
#
# This is not a hole: `CI gate` is separately a required check, so exempting these
# authors does not let unreviewed *code* merge. It lets machine-generated
# dependency bumps merge, which is the intent — nobody reviews them, and without
# this branch .github/workflows/dependabot-auto-merge.yml would be permanently
# blocked by a gate that can never go green.
#
# PRISMALENS: deliberately narrow. Renovate is not installed on this repo, and
# `claude` is an agent account that writes real code — exactly what this gate
# exists to hold. An exemption that is not needed is just a hole.
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

# Paths where a Claude review alone is not enough — see the file itself for why.
#
# Read from the DEFAULT BRANCH checkout, like everything else this script trusts.
# A PR cannot widen or narrow its own risk classification by editing the list on
# its branch; changing the policy takes a merge, and this file is inside
# `.github/**`, so changing it is itself high-risk.
HIGH_RISK_PATHS_FILE="${HIGH_RISK_PATHS_FILE:-.github/high-risk-paths.txt}"

# Marker left by a Claude review run in GitHub Actions.
#
# Written by the `marker` job of .github/workflows/claude-code-review.yml, which
# is gated behind `needs: review` so it cannot run unless the reviewing job
# succeeded, and which additionally refuses to mint a marker unless a
# `claude[bot]` post actually exists at that head. Keyed to the head SHA for the
# same reason as the CLI marker above: evidence vouches for one commit, not the PR.
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
# Named by FILE, never by workflow name or id: the mention lane cannot cause a
# run of a different workflow file to exist, and that is the whole property being
# relied on. Names are not unique; paths are.
CLAUDE_REVIEW_WORKFLOW_FILE="${CLAUDE_REVIEW_WORKFLOW_FILE:-claude-code-review.yml}"

# Carry evidence forward across a branch update that did not change the patch.
#
# THE PROBLEM. `strict_required_status_checks_policy` is on, so every merge to the
# trunk puts every other open PR BEHIND, and updating a branch changes its head
# SHA. Because evidence is keyed to the head SHA, that update discards a review
# that is still perfectly accurate — the PR's own changes did not move, only the
# commit naming them. An N-PR train therefore costs N reviews on top of N CI runs.
# #366 lost a complete CodeRabbit review this way and was merged under an admin
# bypass instead; #392 spent three reviews across three heads.
#
# THE RULE. Evidence recorded at SHA R still counts for head H when, and only
# when, both resolve to the same `git patch-id --stable` over their diff against
# the merge base. Same patch, same review.
#
# WHAT THIS STILL CLOSES. Amending after review — the attack the SHA keying exists
# for, and the realistic one here, since this repo takes no outside contributions
# and the plausible adversary is a drifted or prompt-injected agent pushing to its
# own PR while holding the maintainer's credential. Any real edit changes the
# patch. So does an evil merge: resolving a conflict in favour of attacker content
# is a content change and lands in the diff against the merge base.
#
# WHAT IT OPENS. Semantic drift only — the trunk moves under a PR whose own patch
# is untouched but whose MEANING changed, as when #352 was approved citing a rule
# that #354 deleted. That class is not caught by re-review of the same diff either;
# a reviewer scoped to one diff structurally cannot see it, and it was in fact
# caught only by a consolidated pass across all twelve PRs. `CI gate` is separately
# required and does re-run at the new head, which catches the mechanical half.
#
# FAILING CLOSED. This is a widening, so every uncertainty denies it. A diff that
# cannot be fetched, a patch-id that will not compute, a binary hunk, a cross-repo
# head — all return "not identical", which simply leaves the exact-SHA behaviour
# that shipped before. Nothing here can publish a `success` the old code would not
# have; it can only decline to discard one.
#
# Set CARRY_FORWARD=0 to disable and evaluate strictly by head SHA.
CARRY_FORWARD="${CARRY_FORWARD:-1}"

# How many distinct prior SHAs to test per branch, newest first. A long-lived PR
# accumulates reviews, and each test costs one compare API call; the answer is
# nearly always the newest one or none.
CARRY_FORWARD_MAX_CANDIDATES="${CARRY_FORWARD_MAX_CANDIDATES:-5}"

# An empty or non-numeric limit does not merely mis-size the budget — it removes
# it. The `-gt` test that enforces the cap exits 2 on a non-integer, and this
# script runs without `set -e`, so `&& break` never fires and the loop walks every
# candidate at up to two compare calls each. A bound that silently stops bounding
# is the failure shape this whole script exists to refuse, so an unusable limit
# disables carry-forward rather than uncapping it.
case "$CARRY_FORWARD_MAX_CANDIDATES" in
  ''|*[!0-9]*|0)
    echo "WARNING: CARRY_FORWARD_MAX_CANDIDATES='$CARRY_FORWARD_MAX_CANDIDATES' is not a positive integer — carry-forward disabled" >&2
    CARRY_FORWARD=0
    ;;
esac

# ---------------------------------------------------------------------------

# Does this PR touch a high-risk path?
#
# Returns 0 (yes) when any changed file matches any glob, and — deliberately —
# also when the answer cannot be determined: an unreadable list or an API failure
# means the PR is treated as high risk, which requires MORE evidence rather than
# less. Every other branch of this gate fails closed; so does this.
#
# `**` matches across `/` here, which is what the globs assume: bash pattern
# matching inside `[[ ]]` does not treat `/` specially.
touches_high_risk () { # touches_high_risk <pr number>
  local n="$1" files pat f
  [ -r "$HIGH_RISK_PATHS_FILE" ] || { echo "    high-risk list unreadable — treating as high risk" >&2; return 0; }
  files=$(gh api --paginate "repos/$REPO/pulls/$n/files?per_page=100" --jq '.[].filename' 2>/dev/null) \
    || { echo "    cannot list changed files — treating as high risk" >&2; return 0; }
  while IFS= read -r pat; do
    case "$pat" in ''|\#*) continue ;; esac
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      # shellcheck disable=SC2053  # RHS is a glob on purpose
      [[ "$f" == $pat ]] && { echo "    high-risk: $f matches $pat" >&2; return 0; }
    done <<<"$files"
  done < "$HIGH_RISK_PATHS_FILE"
  return 1
}

in_list () { # in_list <needle> <space-separated haystack>
  local needle="$1" hay="$2" item
  for item in $hay; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

# Patch identity of <sha> relative to <base>, as `git patch-id --stable`.
#
# The diff comes from the compare API rather than a local checkout on purpose:
# review-evidence.yml checks out ONLY `.github/scripts`, sparse and shallow, from
# the default branch. It holds no PR objects and no history to compute a merge
# base from, and fetching enough to get one would cost more than the call this
# replaces. `compare/BASE...HEAD` is already merge-base relative, which is exactly
# the three-dot diff wanted here.
#
# `--stable` makes the hash independent of hunk ORDER, so a rebase that reorders
# untouched changes still compares equal.
#
#   rc 0 = printed a patch-id
#   rc 1 = no usable answer (caller must treat as "not identical")
patch_identity () { # patch_identity <base_ref> <sha>
  local base="$1" sha="$2" diff id
  command -v git >/dev/null 2>&1 || return 1
  diff=$(gh api "repos/$REPO/compare/$base...$sha" \
           -H "Accept: application/vnd.github.diff" 2>/dev/null) || return 1
  [ -n "$diff" ] || return 1

  # GitHub renders a binary change as a single `Binary files a/x and b/x differ`
  # line carrying no content, so two DIFFERENT binaries produce byte-identical
  # diff text and therefore an identical patch-id. Refuse to compare a diff whose
  # contents are not actually in it.
  grep -q '^Binary files ' <<<"$diff" && return 1

  id=$(printf '%s\n' "$diff" | git patch-id --stable 2>/dev/null | awk 'NR==1{print $1}')
  # patch-id prints nothing for an empty patch, and an all-zero id is not a real
  # answer either — an empty diff must never make two PRs compare equal.
  case "$id" in
    ''|*[!0-9a-f]*)                            return 1 ;;
    0000000000000000000000000000000000000000)  return 1 ;;
  esac
  printf '%s\n' "$id"
}

# Memoised patch-id of the head under evaluation. evaluate_pr resets it per PR;
# without that a sweeper run would compare every PR against the first one's head.
_HEAD_PATCH_ID=""
_HEAD_PATCH_ID_TRIED=0

# Does evidence recorded at <candidate> still vouch for <head>?
#   rc 0 = yes (exact match, or patch-identical)
#   rc 1 = no
evidence_sha_ok () { # evidence_sha_ok <head> <candidate> <base_ref> <head_repo>
  local head="$1" cand="$2" base="$3" hrepo="$4" cand_id
  [ "$cand" = "$head" ] && return 0
  [ "$CARRY_FORWARD" = "1" ] || return 1
  # A cross-repo head needs `owner:sha` refs on the compare endpoint and brings a
  # fork's object graph into a decision this gate makes about the trunk. Not worth
  # the surface for a repo that accepts no outside contributions — deny and let
  # the exact-SHA path answer.
  [ "$hrepo" = "$REPO" ] || return 1

  if [ "$_HEAD_PATCH_ID_TRIED" != "1" ]; then
    _HEAD_PATCH_ID_TRIED=1
    _HEAD_PATCH_ID=$(patch_identity "$base" "$head") || _HEAD_PATCH_ID=""
  fi
  [ -n "$_HEAD_PATCH_ID" ] || return 1

  cand_id=$(patch_identity "$base" "$cand") || return 1
  [ "$cand_id" = "$_HEAD_PATCH_ID" ]
}

# Walk newest-first "<sha> <payload>" lines, returning the first whose SHA still
# vouches for the head. Prints "<sha> <payload>"; rc 1 if none qualify.
#
# Distinct SHAs are counted, not lines: several reviews at one commit are one
# candidate and must not consume the budget meant to reach older commits.
first_valid_evidence () { # first_valid_evidence <head> <base_ref> <head_repo> <<< lines
  local head="$1" base="$2" hrepo="$3"
  local line cand seen_count=0 seen=" "
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    cand="${line%% *}"
    case "$seen" in *" $cand "*) continue ;; esac
    seen="$seen$cand "

    # THE EXACT HEAD IS TESTED BEFORE THE BUDGET, ALWAYS.
    #
    # The candidate cap bounds carry-forward's compare-API calls; it has no
    # business bounding the exact-SHA match, which costs nothing and is the
    # behaviour that predates carry-forward entirely. Applying the cap first
    # meant that with carry-forward disabled — `CARRY_FORWARD=0`, or an invalid
    # limit — a genuine review AT the head could be skipped once enough other
    # candidates had been seen. Fail-closed, but it broke the one property this
    # feature promised: that it can only ever ADD greens the old code would not
    # have published, never withhold one it would have.
    if [ "$cand" = "$head" ]; then
      printf '%s\n' "$line"
      return 0
    fi

    seen_count=$((seen_count + 1))
    [ "$seen_count" -gt "$CARRY_FORWARD_MAX_CANDIDATES" ] && break
    if evidence_sha_ok "$head" "$cand" "$base" "$hrepo"; then
      printf '%s\n' "$line"
      return 0
    fi
  done
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

# Fetch ONE JSON object, distinguishing FOUR outcomes rather than three: found,
# genuinely absent, and could-not-tell.
#
# api_query above folds every gh failure into rc 2 because its callers ask LIST
# endpoints, where a 404 means the PR itself is gone and there is no useful
# distinction to draw. Branch D asks single-object endpoints where 404 is a real
# answer — the cited run id does not exist in this repo — while a 5xx, a
# secondary rate limit, or a token missing `actions: read` are not answers at
# all. Collapsing those into "no evidence" is how branch D would end up the one
# branch publishing a confident negative it never computed, which is precisely
# the failure class this whole script exists to prevent.
#   rc 0 = fetched      (JSON body on stdout)
#   rc 1 = 404          (the object genuinely does not exist)
#   rc 2 = could not determine
#
# `-i` is what makes the split possible at all: gh exits 1 for EVERY HTTP error
# alike, so the status code has to be read out of the response itself. A
# transport-level failure (DNS, TLS, unauthenticated gh) prints no status line,
# which falls into the catch-all below and correctly yields rc 2.
api_object () { # api_object <path>
  local path="$1" raw code body
  raw=$(gh api -i "$path" 2>/dev/null)
  code=$(sed -n '1s#^HTTP/[0-9.]\{1,\} \([0-9]\{3\}\).*#\1#p' <<<"$raw")
  case "$code" in
    2*)  ;;
    404) return 1 ;;
    *)   return 2 ;;
  esac
  # Headers end at the first blank line; tolerate CRLF line endings.
  body=$(awk 'BEGIN{h=1} h && /^\r?$/ {h=0; next} !h' <<<"$raw")
  # A 2xx whose body will not parse is not an answer either.
  jq -e . <<<"$body" >/dev/null 2>&1 || return 2
  printf '%s\n' "$body"
}

evaluate_pr () { # evaluate_pr <number>
  local n="$1" pr pr_number sha author state draft head_ref head_repo title base_ref
  local no_evidence_reason=""

  # Per-PR, because the sweeper evaluates many in one process.
  _HEAD_PATCH_ID=""
  _HEAD_PATCH_ID_TRIED=0

  # A fetch failure is not "nothing to do" — it means we cannot evaluate, and the
  # caller must learn about it through the exit code rather than see a clean run.
  pr=$(gh api "repos/$REPO/pulls/$n" 2>/dev/null) || {
    echo "  PR #$n: cannot fetch — NOT evaluated" >&2; return 1; }

  sha=$(jq -r '.head.sha'      <<<"$pr")
  author=$(jq -r '.user.login' <<<"$pr")
  # The CANONICAL number as GitHub reports it, not the argument as typed. Branch
  # D reconstructs an artifact name the workflow built from its own validated
  # input, so `344` and `0344` must not produce two different expected names —
  # the argument round-trips through the API and comes back normalised.
  pr_number=$(jq -r '.number'  <<<"$pr")
  state=$(jq -r '.state'       <<<"$pr")
  draft=$(jq -r '.draft'       <<<"$pr")
  head_ref=$(jq -r '.head.ref' <<<"$pr")
  title=$(jq -r '.title'       <<<"$pr")
  # The branch this PR merges into, for the merge-base-relative diff that patch
  # identity is computed over. Not assumed to be the default branch: a stacked PR
  # targets its parent, and comparing it against the trunk would describe a diff
  # nobody reviewed.
  base_ref=$(jq -r '.base.ref' <<<"$pr")
  # `// ""` matters: head.repo is null when the fork was deleted, and a null here
  # must not compare equal to $REPO.
  head_repo=$(jq -r '.head.repo.full_name // ""' <<<"$pr")

  printf '  PR #%s  head=%s  author=%s  branch=%s  state=%s  draft=%s\n' \
         "$n" "${sha:0:8}" "$author" "$head_ref" "$state" "$draft"

  if [ "$state" != "open" ]; then
    echo "    closed — not evaluated"; return 0
  fi

  # INDEPENDENCE RULE. On a high-risk path, `coderabbitai[bot]` evidence is
  # required specifically: branch A can green the PR, branch D cannot — and
  # neither can the B1/B2 exemptions below.
  #
  # EVALUATED FIRST, BEFORE THE EXEMPTIONS, and that ordering is the whole point.
  # B1 exempts bot authors so machine dependency bumps can merge without a review
  # nobody was ever going to write. But Dependabot updates ACTION VERSIONS inside
  # `.github/workflows/**`, so a bot-authored PR can change the gate's own
  # machinery — and evaluated after B1, it would collect a free `success` on
  # exactly the surface this rule exists to protect. The same applies to B2: the
  # release PR's branch and title are the only things distinguishing it, and
  # neither says anything about what it touches.
  #
  # So a high-risk PR needs independent review whoever opened it. The cost is
  # real and accepted: a Dependabot PR touching `.github/**` no longer
  # auto-merges, and that is the correct trade — a supply-chain bump to the
  # machinery that publishes required checks is precisely the change least worth
  # waving through.
  #
  # Enforced HERE rather than by the admission label, because a label can be
  # removed and a PR-branch workflow can be tampered with, while this script runs
  # from the default branch. review-admit.yml's path filter is the convenience
  # half; this is the half that holds.
  local high_risk=0
  if touches_high_risk "$n"; then high_risk=1; fi

  # --- branch B1: bot-authored --------------------------------------------
  if [ "$high_risk" != "1" ] && in_list "$author" "$BOT_AUTHORS"; then
    publish "$sha" success "Bot-authored ($author); CI gate applies separately"
    return $?
  fi

  # --- branch B2: machine-generated release PR (same-repo AND branch AND title)
  if [ "$high_risk" != "1" ] \
     && [ "$head_repo" = "$REPO" ] \
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
  # The commit_id filter moved OUT of jq and into first_valid_evidence, which
  # accepts the head plus any patch-identical earlier commit. Reviews come back
  # newest-last from the API, so `reverse` puts the newest candidate first.
  #
  # `claude[bot]` cannot appear here: it is not in REVIEWER_LOGINS, deliberately,
  # because that login is shared with the mention lane and so says nothing about
  # which workflow produced the artifact. Claude evidence is branch D's marker,
  # which is bound to a run rather than to a login. See the constant's comment.
  local reviews hit reviewer ev_sha q_rc
  reviews=$(api_query "repos/$REPO/pulls/$n/reviews?per_page=100" '
        ($logins | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | select(.state != "DISMISSED" and .state != "PENDING")
            | select(.commit_id != null)
            | "\(.commit_id) \(.user.login)"
          ] | reverse | .[]' \
      --arg logins "$REVIEWER_LOGINS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi
  if [ -n "$reviews" ] \
     && hit=$(first_valid_evidence "$sha" "$base_ref" "$head_repo" <<<"$reviews"); then
    ev_sha="${hit%% *}"; reviewer="${hit#* }"
    if [ "$ev_sha" = "$sha" ]; then
      publish "$sha" success "Reviewed by $reviewer at ${sha:0:8}"
    else
      publish "$sha" success "Reviewed by $reviewer at ${ev_sha:0:8}; patch unchanged at ${sha:0:8}"
    fi
    return $?
  fi

  # --- branch D: Claude review evidence for this head ----------------------
  #
  # WHAT THIS TRUSTS, AND WHY IT IS NOT THE ARTIFACT
  # -----------------------------------------------
  # `claude[bot]` is an app installation shared by claude-code-review.yml and
  # claude.yml, the mention lane anyone who can comment may trigger. So a post by
  # that login says nothing about which workflow produced it, and it is
  # deliberately absent from REVIEWER_LOGINS.
  #
  # What this branch trusts instead is a marker authored by `github-actions[bot]`
  # from the `marker` job of claude-code-review.yml — a job that runs no model,
  # reads nothing from the PR but its head SHA, and only runs at all when the
  # review job succeeded AND a `claude[bot]` post exists at that head. The
  # reviewing agent holds no credential that can author `github-actions[bot]`.
  #
  # The marker's TEXT is not the evidence. `run:<id>` is a claim; what makes it
  # evidence is that the run exists, ran THIS workflow file, ran against the SHA
  # the marker names, and succeeded. All four are re-derived below from the run
  # id, so a marker that lies about any of them verifies as absent.
  #
  # NO TIMESTAMPS ANYWHERE. The design this replaces bound a `claude[bot]` review
  # to a successful run by comparing submission time against run start. That made
  # a successful run a REUSABLE AUTHORIZATION TOKEN: a run that succeeds while
  # posting nothing — the routine failure mode of a stale tool list, observed
  # twice on 2026-08-09 — leaves an authorization unspent for any later
  # mention-lane post to redeem. Binding to a run *identifier* minted by a job the
  # agent cannot impersonate removes the token entirely.
  #
  # CARRIED FORWARD, unlike the marker design that preceded it. The old branch D
  # verified a run against an artifact NAMED for the reviewed head, so carrying it
  # forward meant either checking the run against a SHA the artifact no longer
  # described or relaxing the artifact match. This marker names its own SHA and
  # the run is verified against that same SHA, so a patch-identical earlier commit
  # carries exactly as branches A and C do — the run still describes the commit it
  # reviewed, and patch identity is what makes that commit speak for this head.
  if [ "$high_risk" = "1" ]; then
    echo "    high-risk path: a Claude review alone does not satisfy this gate" >&2
    no_evidence_reason="high-risk path — needs coderabbitai[bot] review, not Claude alone"
  fi

  local claude_markers claude_hit
  claude_markers=$(api_query "repos/$REPO/issues/$n/comments?per_page=100" '
        ($authors | split(" ")) as $allowed
        | [ .[]
            | select(.user.login as $u | $allowed | index($u))
            | .body
            | try (capture($pre + " (?<s>[0-9a-f]{40}) run:(?<id>[0-9]+)[^0-9]")
                   | "\(.s) \(.id)") catch empty
          ] | reverse | .[]' \
      --arg pre "$CLAUDE_MARKER_PREFIX" --arg authors "$CLAUDE_MARKER_AUTHORS")
  q_rc=$?
  if [ $q_rc -eq 2 ]; then
    publish "$sha" error "Cannot determine review evidence for ${sha:0:8} — GitHub API error"
    return 1
  fi

  if [ "$high_risk" != "1" ] && [ -n "$claude_markers" ] \
     && claude_hit=$(first_valid_evidence "$sha" "$base_ref" "$head_repo" <<<"$claude_markers"); then
    local mk_sha mk_run run_json obj_rc verified=""
    mk_sha="${claude_hit%% *}"; mk_run="${claude_hit#* }"

    # The runs endpoint is scoped to $REPO, so a run id from a fork simply 404s —
    # genuinely absent, which falls through to `failure`. Any OTHER fetch failure
    # — a 5xx, a rate limit, a token without `actions: read` — publishes `error`
    # instead. The two must not collapse: see api_object.
    run_json=$(api_object "repos/$REPO/actions/runs/$mk_run"); obj_rc=$?
    if [ $obj_rc -eq 2 ]; then
      publish "$sha" error "Cannot verify the review run for ${sha:0:8} — GitHub API error"
      return 1
    fi
    if [ $obj_rc -eq 0 ]; then
      # The endswith is anchored on `/` so `not-claude-code-review.yml` cannot
      # pass as `claude-code-review.yml`; a plain suffix test would accept it.
      # `.path` is split at `@` first: a run reached through a reusable workflow
      # reports `owner/repo/.github/workflows/x.yml@refs/heads/main`, and the ref
      # suffix would make an otherwise-correct path fail to match.
      verified=$(jq -r --arg wf "$CLAUDE_REVIEW_WORKFLOW_FILE" --arg s "$mk_sha" '
          if (.status == "completed")
             and (.conclusion == "success")
             and (.head_sha == $s)
             and ((.path // "") | split("@")[0] | endswith("/" + $wf))
          then "ok" else "" end' <<<"$run_json" 2>/dev/null)
    fi

    if [ "$verified" = "ok" ]; then
      if [ "$mk_sha" = "$sha" ]; then
        publish "$sha" success "Claude review evidence from run $mk_run at ${sha:0:8}"
      else
        publish "$sha" success "Claude review from run $mk_run at ${mk_sha:0:8}; patch unchanged at ${sha:0:8}"
      fi
      return $?
    fi
    # Marker present but the run does not back it up. Deliberately NOT an
    # `error`: we determined the answer, and the answer is that there is no
    # evidence. Fall through, carrying the reason so the red states its cause.
    echo "    claude marker cites run $mk_run, which does not verify — ignoring" >&2
    no_evidence_reason="claude marker cites run $mk_run, which does not verify"
  fi

  # --- no evidence ---------------------------------------------------------
  # Reached only when EVERY lookup answered successfully and none matched.
  if [ -n "$no_evidence_reason" ]; then
    publish "$sha" failure "No review evidence for ${sha:0:8} — $no_evidence_reason"
    return $?
  fi
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
