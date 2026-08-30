# Canary log prune

Companion note for `scripts/canary-log-prune.sh`.

This file exists to give the canary a second commit that changes a different file and
introduces nothing reviewable. The point is a head with no new finding on it, so the
liveness comment's inline count reflects only what the previous round posted.

The defect in the script is deliberate and stays unfixed until the observation is recorded.
