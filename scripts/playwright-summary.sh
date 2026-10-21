#!/bin/sh
# Markdown for $GITHUB_STEP_SUMMARY from a Playwright json report: the flaky and
# failed tests by project and location. Usage: playwright-summary.sh <report.json> <heading>
set -eu
jq -r --arg heading "$2" '
  def rows($status): [
    .. | objects | select(has("specs")) | .specs[] | . as $s
    | .tests[] | select(.status == $status)
    | "| \(.projectName) | `\($s.file):\($s.line)` | \($s.title) |"
  ];
  def table($label; $status):
    (rows($status)) as $r
    | if ($r | length) == 0 then empty
      else "", "**\($label)**", "", "| Project | Location | Test |", "| --- | --- | --- |", $r[] end;
  "### \($heading)", "",
  "\(.stats.expected) passed, \(.stats.flaky) flaky, \(.stats.unexpected) failed, \(.stats.skipped) skipped",
  table("Failed"; "unexpected"),
  table("Flaky (passed only on a retry)"; "flaky")
' "$1"
