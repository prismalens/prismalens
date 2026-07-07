---
"@prismalens/engine": patch
---

Harness failure containment: a mid-run harness abort (e.g. deepagents killing its
whole turn on one tool exception) no longer kills a single-branch run — it becomes
the branch's terminal `error` event and the reduce step still synthesizes a partial
report from the evidence already gathered. Setup failures before the first event
(binary missing, init handshake) still propagate. The investigation prompt now pins
file reads/searches to the repository working directory (deepagents' filesystem
tools follow model-supplied absolute paths outside the workspace root), and
`deepagents-acp` is invoked with an explicit `-w <repo>` since it ignores the ACP
`session/new` cwd.
