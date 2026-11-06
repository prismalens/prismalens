#!/usr/bin/env bash
# The look rules Biome cannot see: stylesheets, which biome.json leaves out. Borders as
# structure and deleted tokens in CSS. The JSX rules are Biome plugins in biome-plugins/.
# Args: files (default: all of src). `lint` and the root `format-and-lint` run it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
if [ $# -gt 0 ]; then files=$(printf '%s\n' "$@" | grep -E '\.css$'); else files=$(git ls-files 'src/*.css'); fi
fail=0
gate() { if [ -n "$1" ]; then printf '%s\n%s\n\n' "$2" "$1"; fail=1; fi; }
gate "$(echo "$files" | xargs -r grep -nHE '^\s*border(-(top|right|bottom|left))?\s*:' | grep -vE ':\s*(0|none)\s*;')" "border as structure:"
gate "$(echo "$files" | xargs -r grep -nHE 'raised-edge|hairline-strong|inset 0 0 0 1px')" "deleted token:"
exit $fail
