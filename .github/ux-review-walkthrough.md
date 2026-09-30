# UX review walkthrough

How the operator signs off a milestone. What a frontend PR must carry is in
[AGENTS.md](../AGENTS.md#frontend-changes-carry-a-ux-review).

## 1. List everything awaiting a walk

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state all --limit 100 \
  --json number,title,url,state,mergedAt \
  --template '{{range .}}#{{.number}}  {{.state}}  {{.title}}{{"\n"}}   {{.url}}{{"\n"}}{{end}}'
```

One milestone window, by merge date:

```bash
gh pr list --repo prismalens/prismalens --label ux-review --state merged \
  --search 'merged:>=2026-08-09' --limit 100 --json number,title,url
```

Both stop at `--limit 100`; raise it for a bigger milestone.

## 2. Read the walkthroughs back to back

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

A labelled PR with no section prints `(!)`.

## 3. Audit for the PRs that forgot the label

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

Anything it prints gets `gh pr edit <n> --add-label ux-review` and a `## UX review` section before
the walk continues.

## 4. Sign off

```bash
gh pr comment <n> --body 'UX sign-off: …'
```

## The per-PR gate (suspended while releases are 0.5.x patches, #337)

- A Playwright spec covering the changed surface (#303), or the intended spec named in the PR
  body until the harness lands.
