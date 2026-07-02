# Repository governance (as code)

The repo's GitHub-side **rules and settings** — branch-protection ruleset,
merge/repo settings, and labels — are declared in
[`.github/governance.json`](../.github/governance.json) and applied idempotently
by [`scripts/sync-repo-governance.sh`](../scripts/sync-repo-governance.sh).

This keeps the parts of governance that *aren't* files (and would otherwise be
clicked into the GitHub UI) versioned, reviewable, and reproducible.

## What's covered

| Layer | Where | Applied by |
|---|---|---|
| Community health (CoC, contributing, security, templates) | committed files | git (just being in the repo) |
| Dependency updates | `.github/dependabot.yml` | GitHub (Dependabot) |
| PR-title (conventional commits) check | `.github/workflows/pr-title.yml` | GitHub Actions |
| Repo settings, labels, branch ruleset | `.github/governance.json` | `scripts/sync-repo-governance.sh` |

## The ruleset

Targets the trunk branch **`main`** and enforces:

- no branch deletion, no force-push (`deletion`, `non_fast_forward`);
- changes land via PR (`pull_request`, 0 required approvals — solo-friendly);
- the PR-title check must pass (`required_status_checks`, strict).

## Apply it

Locally (your `gh` must be authenticated as a repo admin):

```bash
# preview — changes nothing
bash scripts/sync-repo-governance.sh --dry-run

# apply
bash scripts/sync-repo-governance.sh

# target another repo / config
bash scripts/sync-repo-governance.sh --repo owner/name --config path/to.json
```

Or from GitHub: **Actions → Repo governance → Run workflow**. That run needs a
`GOVERNANCE_TOKEN` secret (a PAT with **Administration: read/write**); without it
the workflow only does a dry run, because the default `GITHUB_TOKEN` cannot
manage rulesets or repo administration.

## Notes & gotchas

- **Sequencing:** apply the ruleset only *after* the CI workflows exist on
  `main`. A required status check that has never reported will block every PR.
- **Default branch:** `main` is both GitHub's default branch and the protected
  trunk.
- **Private repos:** repository rulesets require GitHub Pro for private repos. The
  script warns and continues; settings and labels still apply.
- **Reusable:** the script is repo-agnostic (`--repo`), so the same mechanism can
  govern other repos from one place.
