# UX review walkthrough — how the operator signs off a milestone

This is the operator's side of the frontend gate. The contributing agent's side — the three
deliverables, the screenshot convention, and the `## UX review` template — lives in
[AGENTS.md](../AGENTS.md#frontend-changes-carry-a-design-gate-a-ux-review-on-the-pr-and-an-e2e-spec).
Nothing here is needed to *write* a compliant PR; it is only needed to *walk* a milestone.

Until 2026-08-09 this walk was a single local file, `~/ai-context/prismalens-ux-ledger.html`.
That file is frozen. Every frontend change now carries its own review evidence in its PR body
under a `## UX review` heading, and the `ux-review` label is what makes the set enumerable.

## Why screenshots are committed rather than attached

Drag-and-drop PR attachments were considered and rejected. An agent driving `gh` cannot create
one — it is a browser-only gesture, so the rule would be unfollowable by the agents it governs.
Attachment bytes also live only in GitHub's CDN with no link to the commit that produced them,
whereas a committed PNG diffs visibly when the surface changes. The repo already did this:
`packages/frontend/e2e/pl-up/screenshots/` predates the pattern, and #396 and #393 each added
their own under `e2e/**/screenshots/`.

## The known cost of this design

**The label is load-bearing and nothing mechanical enforces it.** A frontend PR that is merged
without `ux-review` is invisible to every query below — it drops silently out of the milestone
walk, and nothing anywhere reports that it is missing. The single ledger file could not fail
this way: an entry was either in the document or conspicuously absent from it.

This was accepted knowingly when the pattern changed, on the grounds that evidence belonging
with the code change is worth more than a walkable index. The mitigation is the audit below,
run by hand before each sign-off. Mechanical enforcement is **#304**, not yet built. Do not
skip the audit until it lands.

**#304 must not be built as a SHA-keyed evidence status modelled on #301's `review-evidence`
gate — that pattern was retired in #415.** It derived trust from a third-party reviewer's
incidental artifacts (comments, review objects), which are undocumented and summonable by
anyone who can comment; every predicate written over them relocated the hole rather than
closing it. If a direction is worth naming here, it is a deterministic check over content this
repo authors itself: if the diff touches `packages/frontend`, require a `## UX review` section
in the PR body and the `ux-review` label — both GitHub-native data with no vendor grammar to
drift and nothing to summon. That is a direction, not a decision; #304's design is the
operator's to make.

## 1. List everything awaiting a walk

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state all --limit 100 \
  --json number,title,url,state,mergedAt \
  --template '{{range .}}#{{.number}}  {{.state}}  {{.title}}{{"\n"}}   {{.url}}{{"\n"}}{{end}}'
```

Scope it to one milestone window by merge date — the equivalent of "everything since the last
sign-off":

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state merged \
  --search 'merged:>=2026-08-09' --limit 100 --json number,title,url
```

Both cap at `--limit 100`. Raise it if a milestone ever spans more frontend PRs than that:
`gh` returns the first page rather than telling you it truncated.

## 2. Read the walkthroughs back to back

This prints every `## UX review` section in one pass, without opening a single PR. The `awk`
pass tracks fenced code, so a PR that merely *quotes* the template — a spec, a follow-up, the
governance change itself — is not mistaken for one that filled it in:

```bash
nums=$(gh pr list --repo prismalens/prismalens --label ux-review --state all \
         --limit 100 --json number -q '.[].number' | sort -n) || { echo 'gh pr list failed' >&2; nums=; }
for n in $nums; do
  meta=$(gh pr view --repo prismalens/prismalens "$n" --json number,title \
           -q '"=== PR #\(.number) — \(.title) ==="') || { echo "gh pr view failed on #$n" >&2; break; }
  printf '\n\n%s\n' "$meta"
  gh pr view --repo prismalens/prismalens "$n" --json body -q '.body // ""' |
    awk '/^```/          { fence = !fence; next }
         fence           { next }
         found && /^## / { exit }
         /^## UX review/ { found = 1 }
         found           { print }
         END             { if (!found) print "(!) no ## UX review section" }'
done
```

A PR carrying the label with no section is a gate failure; the loop prints it as `(!)` so it
cannot hide.

## 3. Audit for the PRs that forgot the label

This is the mitigation for the weakness described above. It walks merged PRs in the window,
keeps the ones that touched `packages/frontend/`, and flags any that are missing the label:

```bash
nums=$(gh pr list --repo prismalens/prismalens --state merged --search 'merged:>=2026-08-09' \
         --limit 100 --json number -q '.[].number') || { echo 'gh pr list failed' >&2; nums=; }
for n in $nums; do
  files=$(gh pr diff --repo prismalens/prismalens "$n" --name-only) \
    || { echo "AUDIT INCOMPLETE — gh pr diff failed on #$n; re-run before signing off" >&2; break; }
  grep -q '^packages/frontend/' <<<"$files" || continue
  gh pr view --repo prismalens/prismalens "$n" --json number,title,labels -q \
    'select([.labels[].name] | index("ux-review") | not)
     | "(!) UNLABELLED frontend PR #\(.number) — \(.title)"' \
    || { echo "AUDIT INCOMPLETE — gh pr view failed on #$n" >&2; break; }
done
```

A `gh` failure aborts the audit loudly rather than skipping a PR — a silently skipped PR looks
identical to a compliant one, which is the exact failure this audit exists to catch.

Anything it prints gets `gh pr edit <n> --add-label ux-review` and a `## UX review` section
added to its body before the walk continues. Merged PR bodies are still editable.

## 4. Sign off

Sign-off is a comment on the PR, so the verdict stays attached to the change it judges:

```bash
gh pr comment <n> --body 'UX sign-off: …'
```

Anything wrong goes back through the fix loop via that PR's issue.

## History

Entries from before 2026-08-09 are in the frozen ledger at
`~/ai-context/prismalens-ux-ledger.html` — local to the operator's machine, not in git, and
deliberately not migrated. It stays valid for the changes it describes.
