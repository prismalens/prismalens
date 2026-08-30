# Canary log prune

Companion note for `scripts/canary-log-prune.sh`.

This file exists to give the canary a second commit that changes a different file and
introduces nothing reviewable. The point is a head with no new finding on it, so the
liveness comment's inline count reflects only what the previous round posted.

The defect in the script is deliberate and stays unfixed until the observation is recorded.

## Round 4

Triggered after prismalens/gh-workflows#51 merged, so this round runs the amended review prompt.
The measurement of interest is `permission_denials` on this round against the three before it,
which ran the old prompt. Story: prismalens/gh-workflows#42.
