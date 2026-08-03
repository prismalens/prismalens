# Capability catalog — what you can do today

This is the honest map of PrismaLens functionality as **complete user journeys**, not code
features. A capability is *done* when a user can perform every listed step end-to-end on a
released artifact, with a demonstrable proof. Each in-progress capability is tracked by a
GitHub issue labeled [`capability`](https://github.com/prismalens/prismalens/labels/capability)
that holds its journey definition, proof requirement, and child tickets.

PrismaLens has two independent front doors onto the same investigation engine — the **app**
(API + worker + web UI) and the **CLI** (local-first, `~/.prismalens` as its record). Every
capability names its surface; "works" on one says nothing about the other.

| # | Capability | Surface | Status | Tracking |
|---|---|---|---|---|
| C1 | Service catalog & discovery | app UI | ✅ Complete | [#287](https://github.com/prismalens/prismalens/issues/287) |
| C2 | Integrations, connections & system settings | app UI | ✅ Complete | [#288](https://github.com/prismalens/prismalens/issues/288) |
| C3 | Postmortem & timeline | app UI | ✅ Complete | [#289](https://github.com/prismalens/prismalens/issues/289) |
| C4 | CLI local investigation loop | CLI | ✅ Complete | [#290](https://github.com/prismalens/prismalens/issues/290) |
| C5 | Alert intake → correlation → incident | app UI | 🟦 Near-complete | [#291](https://github.com/prismalens/prismalens/issues/291) |
| C6 | Investigate an incident from the app | app UI | 🟦 Near-complete | [#292](https://github.com/prismalens/prismalens/issues/292) |
| C7 | Storm handling — alert flood → one grouped investigation | app UI | 🟨 In progress | [#293](https://github.com/prismalens/prismalens/issues/293) |
| C8 | Rule management that tells the truth | app UI | 🟨 In progress | [#294](https://github.com/prismalens/prismalens/issues/294) |
| C9 | Run observability & spend | app UI | 🟨 In progress | [#295](https://github.com/prismalens/prismalens/issues/295) |
| C10 | Manual authorship (demo without an alert source) | app UI | 🟨 In progress | [#296](https://github.com/prismalens/prismalens/issues/296) |
| C11 | `pl up` — one command, whole app | CLI → app UI | 🟨 In progress | [#297](https://github.com/prismalens/prismalens/issues/297) |
| C12 | Team operations | app UI | 🟨 In progress | [#298](https://github.com/prismalens/prismalens/issues/298) |
| C13 | Approve → execute (act phase) | app UI | ⬜ OSS-bounded | [#299](https://github.com/prismalens/prismalens/issues/299) |

Statuses: ✅ every step works today · 🟦 core loop works, listed children remain · 🟨 journey
has open gaps · ⬜ this repository intentionally ships only the inert shell — the executing
half lives behind the commercial module boundary (ADR-0023), so C13's definition of done here
is: shell renders inert states correctly, the capability-flag/module seam is verified, and no
execution path exists without a verified module.

## Complete today

### C1 — Service catalog & discovery

1. **Settings → Connections**: add a VCS/deployment connection.
2. **Services**: add a service manually, or *Import from VCS*.
3. **Services → Discovery**: run discovery, then accept/reject/ignore each suggestion.
4. **Service detail**: link repositories and deployments, manage dependencies — the topology
   view reflects them.

### C2 — Integrations, connections & system settings

1. **Settings → Integrations**: add an integration from a template and configure it
   (GitHub App install or OAuth org/repo pickers).
2. **Settings → Connections**: add, edit, and *Test Connection* — the full OAuth loop is
   wired, including callback status banners.
3. **Settings → AI Provider**: save and test LLM credentials, set the active provider and
   per-agent overrides.
4. **Settings → Investigation**: set per-tier auto-investigation policies and limits.
5. **Settings → Danger Zone**: typed-confirmation data reset or factory reset.

### C3 — Postmortem & timeline

1. **Incident detail → Timeline**: add and filter timeline entries.
2. **Incident detail → Postmortem**: *Start Blank* or *Auto-populate from AI*.
3. Edit fields (auto-saved) and manage action items.
4. *Publish* locks the postmortem read-only; delete requires confirmation.

### C4 — CLI local investigation loop

1. `pl init` scaffolds a config; `pl auth login` stores your LLM key (bring-your-own-key).
2. `pl doctor` preflights the harness, credentials, and workspace.
3. `pl listen` receives Alertmanager webhooks — or pipe an alert into `pl investigate`.
4. `pl status` lists runs; `pl report <id>` prints the ordered-evidence report.

## How this catalog is maintained

- Every capability issue carries the journey steps, a **proof** requirement (demo against a
  released artifact), and a task-list of child tickets. Phase milestones stay as they are;
  a phase's live-test exit gate now means *its capability issues are demoed per their steps*.
- When a capability flips to complete: check its last box, close the issue, and update its
  row (and, if user-facing steps changed, its journey section) here.
- New functionality enters as a child of an existing capability, or as a new capability row —
  never as a free-floating feature with no journey.
