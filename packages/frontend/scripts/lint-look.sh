#!/usr/bin/env bash
# The look ruling's static gates (rev 2 §6): no border as structure, no DOM title
# tooltips, no native <select>, no deleted tokens. Args: files (default: all of src).
# Not yet part of `lint`; the last look PR wires it in.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
if [ $# -gt 0 ]; then files=$(printf '%s\n' "$@"); else files=$(git ls-files 'src/*.tsx' 'src/*.css'); fi
fail=0
gate() { if [ -n "$1" ]; then printf '%s\n%s\n\n' "$2" "$1"; fail=1; fi; }
gate "$(echo "$files" | xargs -r grep -nHE '\b(border(-[trblxy])?(-hairline)?|ring-[0-9]|ring-\[|shadow-\[inset)\b' \
	| grep -vE 'focus-visible|focus-within|border-0|border-none|border-transparent|border-l-transparent|shared/(Row|SettingRow)\.tsx|^\S+:[0-9]+:\s*(//|\*|/\*)|^\S+\.css:[0-9]+:\s*border-(radius|color):')" "border as structure:"
gate "$(echo "$files" | xargs -r grep -nHE '<(div|span|button|a|td|li|svg|p|time|abbr|img)\b[^>]*\btitle=')" "DOM title tooltip:"
gate "$(echo "$files" | xargs -r grep -nH '<select')" "native select:"
gate "$(echo "$files" | xargs -r grep -nHE 'raised-edge|hairline-strong|inset 0 0 0 1px')" "deleted token:"
exit $fail
