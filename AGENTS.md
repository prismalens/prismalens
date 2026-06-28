# AGENTS.md

Instructions for AI coding agents working in this repository.

## Engineering standards (gates)

Four standards every change must meet. This prose is the *intent*; the teeth are
lint + CI (being wired separately — until those land, reviewers enforce). Code
that meets these comes out at-bar, so there's less to re-review.

1. **Validate at boundaries with zod — not `as` casts.** Anything crossing a
   trust boundary (HTTP/SSE payloads, DB rows, LLM/tool output, env) is parsed by
   a zod schema; the inferred type flows inward. `as` / `as unknown as` hide drift
   until it crashes a user. Wire types live only in `@prismalens/contracts`.
2. **Handle the unhappy paths, not just the happy one.** Crash/restart, cancel,
   reconnect, and persist-failure are part of the feature — design up front for
   orphaned runs, aborted work, dropped streams, and failed writes.
3. **Safety by construction, not denylist.** Capabilities come from an allowlist
   of what's permitted; a blocklist of "bad" inputs is a UX guardrail, never the
   security boundary (ADR-0009).
4. **Test the risky paths.** Security, concurrency, and lifecycle seams
   (capability/allowlist checks, single-flight, crash reconciliation,
   cancel-during-run, persistence failure) carry tests.

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

**Commit hygiene:** mage never commits for you. It suggests `git` commands; you
run them.
<!-- END mage -->
