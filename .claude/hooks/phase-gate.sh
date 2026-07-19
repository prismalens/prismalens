#!/bin/bash
# PostToolUse(Bash) hook: when a GitHub milestone is closed (gh api PATCH ... milestones
# ... state=closed), inject a reminder to run the phase-completion gate.
# Born 2026-07-19: two milestones were closed and two versions shipped without the
# anti-drift ritual or a released-artifact smoke test. Silent for every other Bash call.
in=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$in" 2>/dev/null) || exit 0
case "$cmd" in
  *milestones*state=closed*|*state=closed*milestones*) ;;
  *) exit 0 ;;
esac
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"A milestone was just closed — this is a PHASE BOUNDARY. Before calling the phase done: (1) run the 11-step anti-drift ritual from the hub note projects/prismalens-platform/notes/roadmap/phase-checklist.md (ledger, roadmap, architecture specs, ADR outcomes, build-history, render, mage index, review dates, hub PR); (2) smoke-test the RELEASED artifact from the registry (not a local build) against the CLI behavior inventory; (3) sweep docs for names/ids the phase renamed. If a phase-gate issue exists in the milestone, close it last with links to both."}}\n'
