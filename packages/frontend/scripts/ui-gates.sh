#!/usr/bin/env bash
# Copy gates on the lines a change adds under src (vs a base, default origin/main): no em
# dashes, sparkles or arrows, uppercase mini-headings, or empty-state copy over five words.
# Whole-file look rules are Biome plugins (biome-plugins/). Usage: scripts/ui-gates.sh [base].
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
base="${1:-origin/main}"
added=$(git diff -U0 "$base" -- 'src/*.tsx' 'src/*.ts' 'src/*.css' ':!src/**/*.test.*' ':!src/routeTree.gen.ts' ':!src/styles/tokens.css' \
	| grep -E '^\+[^+]' | grep -vE '^\+\s*(//|\*|/\*|\{/\*)')
fail=0
gate() { local hits; hits=$(echo "$added" | grep -nE "$2" | grep -vE "${3:-^$^}"); if [ -n "$hits" ]; then printf '%s\n%s\n\n' "$1:" "$hits"; fail=1; fi; }
gate "em dash in UI" '—'
gate "sparkles / trailing arrow" 'Sparkle|ArrowRight|→'
gate "uppercase mini-heading" '\buppercase\b'
long=$(echo "$added" | grep -oE '<(Empty|Blank)[^>]*(text|title|description)="[^"]+"' | grep -oE '(text|title|description)="[^"]+"' \
	| sed -E 's/^[a-z]+="//; s/"$//' | awk 'NF>5')
[ -n "$long" ] && { printf 'empty-state copy over 5 words:\n%s\n\n' "$long"; fail=1; }
[ $fail -eq 0 ] && echo "ui gates: pass"
exit $fail
