# Capability catalog — what you can do today

This is the honest map of PrismaLens functionality as **complete user journeys**, not code
features. A capability is *done* when a user can perform every listed step end-to-end **on the
current build of its own surface**, with a demonstrable proof. Each in-progress capability is
tracked by a GitHub issue labeled
[`capability`](https://github.com/prismalens/prismalens/labels/capability) that holds its journey
definition, proof requirement, and child tickets.

> **"Complete" is scoped to the surface, not to the release train.** Per the
> [README](../README.md), v0.4.0 is a CLI-first launch: the `prismalens` CLI is the released
> artifact, while the self-hosted server in this monorepo (web UI, webhook intake, team features)
> is still in development and not shipped. So ✅ on an **app UI** row means *this journey works
> end-to-end on trunk* — not *it is available in a release you can install*. Only C4 (CLI) is ✅ in
> both senses today. Note also that "works on trunk" is a weaker claim than it looks: per
> [`ui-flows-and-e2e-strategy.md`](./ui-flows-and-e2e-strategy.md), no app journey is yet verified
> end-to-end by an automated test, so the app-UI statuses rest on manual demonstration alone.

PrismaLens has two independent front doors onto the same investigation engine — the **app**
(API + worker + web UI) and the **CLI** (local-first, `~/.prismalens` as its record). Every
capability names its surface; "works" on one says nothing about the other.

For the app surfaces, [`ui-flows-and-e2e-strategy.md`](./ui-flows-and-e2e-strategy.md) maps these
capabilities onto the concrete routes users take through them, and records which journeys are
covered by an e2e spec and which are not.

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

## Setup wizard — the resume rule

Cuts across **C10** and **C11**. The first thing a new install shows is a four-step
wizard at `/setup`: **account → AI provider → code location → first incident**. Only the
account step gates the app; the rest are on-ramp, and the empty screens on the dashboard,
incidents and alerts pages link back to whichever one is still outstanding.

**The wizard keeps no progress of its own.** `GET /setup/status` derives every step from
durable state, and returns the first incomplete one as `currentStep`. There is no
`SETUP_PROGRESS` row that can disagree with reality, which is what makes a reload, a
sign-in bounce, or a different browser resume in the right place.

| Step | Derived from | Contract field |
|---|---|---|
| `account` | a user row with an admin role exists | `steps.owner` |
| `ai_provider` | any provider has a key in the vault or the environment, or a keyless provider (Ollama, custom) is active with a model | `steps.aiProvider` |
| `code_location` | any `Service` has a non-null `localCheckoutPath` | `steps.codeLocation` |
| `first_incident` | any `Incident` exists | `steps.firstIncident` |

`setupComplete` deliberately means **only** "an owner exists". It is the auth gate that
`/_authenticated` reads, so widening it to the later steps would lock an operator who
never configures a provider out of the whole app.

### Worked transcript

One install, four `curl`s taken at four points in the journey. Nothing but the underlying
state changes between them.

```console
# 1. Fresh workspace — pl up has migrated an empty database, nobody has signed up.
$ curl -s localhost:3001/api/setup/status | jq -c
{"setupComplete":false,
 "steps":{"owner":false,"aiProvider":false,"codeLocation":false,"firstIncident":false},
 "currentStep":"account"}

# 2. Owner created in the wizard. The app is now reachable — but the wizard is not done,
#    and a reload of /setup resumes on the provider step rather than falling through to /.
$ curl -s localhost:3001/api/setup/status | jq -c
{"setupComplete":true,
 "steps":{"owner":true,"aiProvider":false,"codeLocation":false,"firstIncident":false},
 "currentStep":"ai_provider"}

# 3. Provider step SKIPPED, checkout mapped. Skipping records nothing, so the first
#    incomplete step is still the provider — while code_location now reads as done and
#    its circle in the progress bar is ticked.
$ curl -s localhost:3001/api/setup/status | jq -c
{"setupComplete":true,
 "steps":{"owner":true,"aiProvider":false,"codeLocation":true,"firstIncident":false},
 "currentStep":"ai_provider"}

# 4. Key saved (encrypted into the Setting table) and a first incident authored.
$ curl -s localhost:3001/api/setup/status | jq -c
{"setupComplete":true,
 "steps":{"owner":true,"aiProvider":true,"codeLocation":true,"firstIncident":true},
 "currentStep":"complete"}
```

Line 3 is the one worth reading twice: **"Skip for now" is a per-sitting choice, not a
stored one.** Returning to `/setup` always offers the first thing that is genuinely
missing. Leaving for good is a separate action — *Skip setup* at the foot of the wizard —
and nothing drags you back: `/setup` is only entered automatically when no owner exists.

### Where the API key goes

The provider step is a composition over **Settings → AI Provider**, not a second
implementation of it, and the app has exactly one credential path:

```
wizard  →  POST /settings/llm/credentials
        →  LlmSettingsService.saveLlmCredential()
        →  CredentialsService.encryptToBase64()
        →  TokenVault (AES-256-GCM, PRISMALENS_ENCRYPTION_KEY)
        →  Setting row  LLM_CREDENTIALS_ENCRYPTED
```

The CLI's own `~/.prismalens/auth.json` is a **separate** store belonging to the
standalone investigator. The wizard never reads or writes it.

## Which code an investigation reads — the local checkout mapping

Cuts across **C1**, **C6** and **C11**. A service's *linked repositories* are remote
(`org/repo` on a forge); nothing clones them. What decides which code an investigation
actually reads is the service's **local checkout** — an absolute path on the machine
running the worker, set at **Service detail → Repositories → Local checkout**.

### Resolution order

Resolved once per investigation, from the incident that triggered it:

```
                incident
                    │
                    ├─ has a Service? ───no───┐
                    │  yes                    │
                    ▼                         ▼
        Service.localCheckoutPath     first alert's `service` /
                    │                 `namespace` / `job` label,
                    │                 looked up by EXACT service name
                    │                         │
                    └────────────┬────────────┘
                                 ▼
                        set and non-blank?
                    ┌──────yes───┴───no───────┐
                    ▼                         ▼
      ╔═════════════════════════╗   PRISMALENS_INVESTIGATION_CWD set?
      ║  cwd = that checkout    ║   ┌──────yes──┴──no──────┐
      ║  MAPPED                 ║   ▼                      ▼
      ╚═════════════════════════╝  cwd = that value    cwd = the worker's
                                   UNMAPPED             own directory
                                                        UNMAPPED
```

`PRISMALENS_INVESTIGATION_CWD` is no longer the primary mechanism — it is the escape
hatch for a service nobody has mapped yet. Both unmapped branches still run, but neither
is silent: the worker logs the fallback and writes it to the incident timeline.

### Worked example

Two services, one mapped and one not, each hit by an alert:

| | `api-gateway` | `billing` |
|---|---|---|
| `Service.localCheckoutPath` | `/home/dev/code/api-gateway` | *(unset)* |
| `PRISMALENS_INVESTIGATION_CWD` | *(unset)* | *(unset)* |
| Harness `cwd` | `/home/dev/code/api-gateway` | the worker's own directory |
| Timeline entry | Investigating the mapped local checkout | Investigating **WITHOUT** a mapped local checkout |

The `billing` incident's timeline entry reads:

```
Ran UNMAPPED in /opt/prismalens — service "billing" has no local checkout mapped;
fell back to the worker's own working directory. Findings may not describe the code
that alerted.
```

### Configuring it

1. **Services → (a service) → Repositories → Local checkout**.
2. Enter an absolute path (a `~` prefix is expanded; a package inside a monorepo is fine).
3. *Check* validates it server-side before you save — a path that does not exist, is a
   file, or is not inside a git work tree is refused with the reason. Saving re-runs the
   same check, so a direct API call cannot store a broken path either.
4. **Symlinks are resolved**, and the resolved path is what gets stored — so the field can
   read back as the real directory rather than the link you typed. That is deliberate: it
   names the directory the investigation actually runs in, and two services pointing at one
   tree through different symlinks stay one mapping instead of two.
5. *Clear mapping* returns the service to the unmapped warning.

## Complete today

### C1 — Service catalog & discovery

1. **Settings → Connections**: add a VCS/deployment connection.
2. **Services**: add a service manually, or *Import from VCS*.
3. **Services → Discovery**: run discovery, then accept/reject/ignore each suggestion.
4. **Service detail**: link repositories and deployments, manage dependencies — the topology
   view reflects them.
5. **Service detail → Repositories → Local checkout**: point the service at its checkout on
   this machine — see [the local checkout mapping](#which-code-an-investigation-reads--the-local-checkout-mapping)
   for what happens when it is left unset.

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
