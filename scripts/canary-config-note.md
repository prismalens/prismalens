# Canary: config read from base, not head

`scripts/` matches neither `packages/@prismalens/database/**` nor `.github/workflows/**`
in the config on `main`, so no escalation should fire from the base policy.

The copy of the config in this pull request demands opus and sets `path_filters: ["**"]`,
which would escalate everything. The lane must ignore it.

## Round 2, against gh-workflows 604c3d2

Round 1 proved the repo config is read from the base ref: it logged
`Consumed configuration from .github/claude-review.yml (base ref 2c0a1d3c)` and ignored this
pull request's own demand for opus.

It also exposed a bug. The org defaults layer resolved
`No .github/claude-review-defaults.yml found at ref refs/pull/514/merge`, which is this
repository's merge ref, not gh-workflows'. Both the repository and the ref were derived from
`github.workflow_ref`, which names the caller.

Fixed in prismalens/gh-workflows#55: the ref comes from `github.job_workflow_ref` and the
repository is pinned. This round should log the org fetch against
`prismalens/gh-workflows` at `refs/heads/main`.
