# AGENTS.md

Instructions for AI coding agents working in this repository.

<!-- BEGIN mage -->
## mage knowledge base (external hub)

This repository's durable knowledge lives in an external **mage hub** at
`/home/sumit/prismalens-org/prismalens-docs-hub`, where this repo is the **prismalens-platform** project. mage is a portable,
file-based knowledge base of notes — insight, procedure, and pointers (not
copies of sources) — navigable as an Obsidian graph.

**Before non-trivial work in this repo:**

1. Read the hub index first: `/home/sumit/prismalens-org/prismalens-docs-hub/INDEX.md` — find the **prismalens-platform** wing (its
   notes are grouped there; in a large hub the wing links out to its own
   `/home/sumit/prismalens-org/prismalens-docs-hub/_index.prismalens-platform.md`). One line per note: type · title · keywords · → link. Open
   only the notes the task touches; don't read everything.
2. Skim `/home/sumit/prismalens-org/prismalens-docs-hub/decisions/` for the hub's governing decisions.
3. Treat notes as point-in-time. If a note is `status: stale-suspect`, or its
   `last_reviewed` / `provenance.commit` looks old, verify it against the
   current code before relying on it.

**After you learn something durable** — an interface detail, a gotcha, how two
services couple, a faster path to a source — capture it with `/mage-learn` into
the hub. Capture the reusable *insight + procedure + pointers*, never a copy.

**Cross-link, don't just file.** A standalone note is write-only — it won't be
recalled at the point of need unless the doc you read there links to it. So when
you capture a research/option `note`, wire its `[[wikilink]]` **inline into the
specific ADR section(s) it bears on** (and those ADRs' `## Relations`),
**bidirectionally** (note→ADR and ADR→note), then `mage index`. See the hub note
`cross-link-research-into-decisions` for the procedure + the failure it prevents.

**Commit hygiene:** mage never commits for you. It suggests `git` commands; you
run them.
<!-- END mage -->

## Implementation specs must declare docs impact

Every implementation spec handed to a coding agent must name a **Docs surfaces** deliverable: the specific files (README.md section, docs/ page, CLI --help text, mage note) the change is expected to update — or state explicitly "none affected because …". A spec without either is incomplete; do not start implementation until it's added.
