# Canary: config read from base, not head

`scripts/` matches neither `packages/@prismalens/database/**` nor `.github/workflows/**`
in the config on `main`, so no escalation should fire from the base policy.

The copy of the config in this pull request demands opus and sets `path_filters: ["**"]`,
which would escalate everything. The lane must ignore it.
