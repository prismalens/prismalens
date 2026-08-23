# UI flow inventory & e2e strategy

The app's counterpart to [`capabilities.md`](./capabilities.md). Where the capability catalog
answers *what can a user accomplish*, this document answers *how do they move through the app to
do it, what states can that surface be in, and is any of it verified by a test*.

Two things live here:

1. **The flow inventory** — every user journey through `packages/frontend`, derived from the
   actual route tree and the mutations wired to it, with a coverage verdict per journey.
2. **The e2e strategy decision** — scope, CI tier, what #225 contributes, and sequencing against
   `pl up` (#237). Resolves [#268](https://github.com/prismalens/prismalens/issues/268).

The harness this measures against is the Playwright suite merged in
[#316](https://github.com/prismalens/prismalens/pull/316): chromium-only, isolated stack
(`PRISMALENS_WORKSPACE_DIR` temp dir + `PRISMALENS_SEED_DEMO=1`), auth storage-state fixture, and
four journey specs under `packages/frontend/e2e/journeys/`. **Playwright is the chosen tool; that
question is closed.**

## Coverage matrix

Verdicts: ✅ journey verified end-to-end · 🟦 read path verified, write path not · ⬜ no coverage ·
◻️ no UI surface exists yet (nothing to cover).

| # | Journey | Route(s) | Capability | Covering spec | Verdict |
|---|---|---|---|---|---|
| J1 | First-run setup (owner account) | `/setup` | C11 | — | ⬜ |
| J2 | Sign in & session guard | `/auth/login`, `/_authenticated` | — | `auth.setup.ts` | 🟦 happy path only |
| J3 | Command center (landing) | `/` | C5, C6 | — | ⬜ |
| J4 | Service catalog & discovery | `/services`, `/services/discovery` | C1 | `services-discovery.spec.ts` | 🟦 |
| J5 | Service detail — repos, deployments, dependencies | `/services/$id` | C1 | `services-discovery.spec.ts` | 🟦 title + tier only |
| J6 | Alerts triage | `/alerts` | C5 | `alerts-investigations.spec.ts` | 🟦 count only |
| J7 | Incident list & analytics | `/incidents` | C5 | `incident-postmortem.spec.ts` | 🟦 list tab only |
| J8 | Incident detail & correlation | `/incidents/$id` | C5, C6 | `incident-postmortem.spec.ts` | 🟦 2 of 6 tabs |
| J9 | Postmortem & timeline authoring | `/incidents/$id` (tabs) | C3 | `incident-postmortem.spec.ts` | 🟦 create only |
| J10 | Investigation view | `/investigations`, `/investigations/$id` | C6 | `alerts-investigations.spec.ts` | 🟦 1 of 3 tabs |
| J11 | Storm — flood → one grouped investigation | (no dedicated route) | C7 | — | ⬜ |
| J12 | Settings — AI provider, policy, connections, danger zone | `/settings?tab=…` | C2, C9 | `integrations-settings.spec.ts` | 🟦 1 of 5 tabs |
| J13 | Integration configuration | `/settings/integrations/configure` | C2 | `integrations-settings.spec.ts` | 🟦 render only |
| J14 | Team operations & RBAC | — | C12 | — | ◻️ |
| J15 | Correlation & alert-mapping rule management | `/rules?tab=…` | C8 | `rules-management.spec.ts` | ✅ |
| J16 | Approve → execute | — | C13 | — | ◻️ by design (ADR-0023) |
| J17 | Manual authorship (demo without an alert source) | `/incidents`, `/incidents/$id` | C10 | `manual-authorship.spec.ts` | ✅ |

**Read this matrix as: 17 journeys, 6 specs, 2 journeys verified end-to-end.** Nearly every
✅-shaped claim the suite could make, it still does not make. See [What the specs actually
prove](#what-the-specs-actually-prove).

Every capability in [`capabilities.md`](./capabilities.md) has a row above except **C4 (CLI local
investigation loop)**, which is a CLI surface with no frontend journey by definition — it is
covered by the CLI's own packed-smoke and cross-os-smoke tiers, not by Playwright.

## The journeys

### J1 — First-run setup (owner account)

- **Entry point**: any URL while `setup.getStatus().setupComplete` is false. The
  `/_authenticated` layout's `beforeLoad` throws `redirect({ to: "/setup" })` with the original
  href preserved in `?redirect=`.
- **Route**: `/setup` → `SetupWizard` → `SetupStepOwner` → `setup.createOwner`.
- **Goal**: create the administrator account that the whole app hangs off.
- **States**: `currentStep: "account"` (the wizard renders); `currentStep: "complete"` (the route's
  own `beforeLoad` redirects back out to `?redirect` or `/`); **API unreachable** — the loader
  swallows the error and falls back to `initialStep: "account"`, so a dead API renders a wizard
  that cannot submit; form validation errors on the owner form.
- **Coverage**: none. The harness seeds a database where setup is already complete, so this route
  is never reached in any spec. **This is the single most important gap**: it is the first screen
  a `pl up` user sees, and the only one where failure means the product never starts.

### J2 — Sign in & session guard

- **Entry point**: `/auth/login`, or any authenticated route without a session.
- **Routes**: `/auth/login` (has its own `beforeLoad` + `redirect`), `/_authenticated` guard.
- **Goal**: obtain a Better Auth session (cookie, 7-day lifetime; cached in TanStack Query with a
  60s `staleTime`).
- **States**: unauthenticated → redirect carrying `?redirect=<href>`; invalid credentials → inline
  error; submitting; already-signed-in → redirect away from `/auth/login`; expired session
  mid-session.
- **Coverage**: `e2e/auth.setup.ts` performs the happy path once to mint the storage state. No spec
  asserts the failure state, the `?redirect` round-trip, or sign-out.

### J3 — Command center (landing)

- **Entry point**: `/` after sign-in — the app's front door.
- **Route**: `/_authenticated/` (423 lines, the largest route in the app).
- **Goal**: see what needs attention now — active incidents, triggered alerts, pending
  recommendations — and launch an investigation from it (`incidents.investigate`).
- **States**: loading (`IncidentListSkeleton`, `IncidentDetailSkeleton`); **empty**
  (`DashboardEmptyState`); **LLM not configured** (`LLMWarningBanner`, driven by
  `llmSettings.activeProvider`); **API down** (`ApiStatusCheck`); incident selected → detail panel;
  investigate-in-flight.
- **Coverage**: none. `auth.setup.ts` incidentally asserts the string `Services` is visible after
  landing on `/`, which is a navbar assertion, not a dashboard one. The empty state and the
  LLM-warning banner — the two states a brand-new `pl up` install renders — are untested.

### J4 — Service catalog & discovery

- **Entry point**: navbar → Services.
- **Routes**: `/services`, `/services/discovery`.
- **Goal**: get a service catalog into the system, by hand or by importing from VCS, then triage
  what discovery proposes.
- **States**: loading; empty catalog; populated; unlinked-repository / unlinked-deployment counts
  surfaced as badges; discovery running; discovery empty; discovery error; per-suggestion
  accept / reject / ignore; bulk accept.
- **Write paths** (nine): `services.create`, `services.update`, `services.delete`,
  `repositories.batchCreate`, `serviceDiscovery.triggerDiscovery`,
  `serviceDiscovery.acceptSuggestion`, `serviceDiscovery.rejectSuggestion`,
  `serviceDiscovery.ignoreSuggestion`, `serviceDiscovery.acceptBulkSuggestions`.
- **Coverage**: `services-discovery.spec.ts` asserts five seeded service names render, and that
  `/services/discovery` renders its heading. No write path is exercised — not one of the nine
  mutations above is called by any test.

### J5 — Service detail

- **Entry point**: a service card in J4.
- **Route**: `/services/$id`.
- **Goal**: link repositories and deployments, manage dependencies, set per-service integration
  overrides, and see the topology reflect it.
- **States**: loading (`ServiceDetailSkeleton`); error / not-found; the tab set implemented as
  `ServiceOverviewTab`, `ServiceRepositoriesTab`, `ServiceDeploymentsTab`,
  `ServiceDependenciesTab`, `ServiceIntegrationsTab`, `ServiceInvestigationTab`; each with its own
  empty state and link/unlink dialogs.
- **Coverage**: one heading and one tier badge on the seeded `api-gateway`. Six tabs and their
  dialogs are untested.

### J6 — Alerts triage

- **Entry point**: navbar → Alerts, or the dashboard's alert stats.
- **Route**: `/alerts`.
- **Goal**: see what fired, filter it, acknowledge or resolve.
- **States**: loading; status filter (`all` | triggered | acknowledged | resolved); severity
  filter; refresh in flight; pagination (60 seeded alerts); acknowledge / resolve mutations
  (wired inline in the route, not via the `useAcknowledgeAlert` / `useResolveAlert` hooks, which
  are unused).
- **Coverage**: `alerts-investigations.spec.ts` asserts `data-testid="alerts-total-count"` reads
  `60` — the #309 pagination-total regression guard. Filters and both mutations are untested.

### J7 — Incident list & analytics

- **Entry point**: navbar → Incidents.
- **Route**: `/incidents`, tabs `list` | `analytics`.
- **Goal**: browse and filter incidents; read MTTR and distribution trends.
- **States**: loading; empty; date-range filter; severity/status filters; the `analytics` tab
  rendering four charts (`IncidentsOverTimeChart`, `MTTRTrendChart`,
  `ServiceDistributionChart`, `SeverityDistributionChart`), each with its own empty case.
- **Coverage**: the heading plus one seeded incident title. **The analytics tab is never opened by
  any test** — four chart components with zero coverage.

### J8 — Incident detail & correlation

- **Entry point**: an incident row from J3 or J7.
- **Route**: `/incidents/$id`, tabs `overview` | `alerts` | `investigation` | `recommendations` |
  `timeline` | `postmortem`.
- **Goal**: understand one incident, see the alerts that correlated into it, launch or follow its
  investigation, act on recommendations.
- **States**: loading (skeleton); error / not-found; per-tab empty states; `incidents.investigate`
  in flight; recommendation complete / dismiss / update.
- **Coverage**: `incident-postmortem.spec.ts` opens `timeline` and `postmortem`. The `alerts`,
  `investigation`, and `recommendations` tabs — the correlation and act surfaces — are untested,
  as is triggering an investigation.

### J9 — Postmortem & timeline authoring

- **Entry point**: J8's Timeline and Postmortem tabs.
- **Goal**: build the incident record — timeline entries, then a postmortem that gets published.
- **States**: timeline empty ("Timeline entries will appear…"); add-entry dialog; entry delete;
  postmortem absent → *Start Blank* / *Auto-populate from AI*; draft (auto-saving); **published
  (read-only lock)**; delete-with-confirmation.
- **Coverage**: the spec clicks *Start Blank* and asserts the title placeholder appears — the only
  write path any merged spec exercises. Editing, auto-save, **publish** (the state transition that
  locks the record) and delete are untested.

### J10 — Investigation view

- **Entry point**: an investigation card from J3, J7, or J8; or navbar → Investigations.
- **Routes**: `/investigations`, `/investigations/$id`, tabs `canvas` | `agents` | `analysis`.
- **Goal**: watch an investigation run, then read its report and root cause.
- **States**: list loading / empty / populated; detail loading (skeleton) / error; **canvas**
  (React Flow graph, node details panel, export menu); **agents** tab; **analysis** tab (root
  cause, culprit or no-culprit, recommendations, evidence); `investigations.cancel`; and the live
  `InvestigationStreamPanel`, which has five states of its own — `idle`, `connecting`,
  `streaming`, `completed`, `error` (ADR-0008 canonical stream).

#### Where the canvas and agents tab get their data

One data source, two transports. `transformLiveEventsToCanvas` is the *only* canvas transform:
it takes canonical events (ADR-0008) and returns the nodes and edges. Those events reach it live
over SSE while the run is active, and from a replay of the durable canonical-event record once it
has finished — `GET /investigations/:id/events`, seq-cursor paginated and looped to completion by
`src/lib/api/hooks/use-investigation-events.ts`. The **agents tab count** and the canvas's
**Export JSON** are both derived from those same event-derived nodes, so the three surfaces cannot
disagree. The old render-on-completion path over `AgentExecution` / `ToolExecution` rows is
retired ([#417](https://github.com/prismalens/prismalens/issues/417)); there is no second source
left to drift.

Which transport feeds the canvas is decided once per render, from `investigation.status`:

```
                        investigation.status
                                 │
              ┌──────running/pending──┴──completed/failed──┐
              ▼                                            ▼
   useInvestigationStream (SSE)              useInvestigationEventsHistory
   /investigations/:id/stream                GET /investigations/:id/events
              │                                            │
      first event arrived?                          fetch settled?
      ┌───no──┴──yes──┐                        ┌───no───────┴──yes──┐
      ▼               ▼                        ▼                    ▼
"Connecting to    graph grows            "Loading investigation   events > 0 ?
 stream…"         event by event,         events…"                ┌──no──┴─yes─┐
                  re-fits per node                                ▼            ▼
                                                            empty canvas   whole graph
                                                            (record is     at once,
                                                             genuinely     fitted once
                                                             empty)
```

Both placeholders render under the same `data-testid="canvas-stream-connecting"`; only the copy
differs, because a finished investigation is fetching a durable record, not connecting to
anything.

- **Coverage**: the `analysis` tab is covered well: `alerts-investigations.spec.ts` asserts both
  the culprit case (service, change ref `v2.4.1`, mechanism) and the **no-culprit** case — that
  absence stays absence and no culprit section is invented. That is the strongest assertion in the
  suite. The **live** canvas is covered by `live-canvas.spec.ts` (#247), which drives real
  `CanonicalEvent` payloads through a controlled `EventSource` stand-in and asserts the connecting
  placeholder, a node appearing per `agent_step`, a tool count updating in place, the re-fit that
  keeps the newest node in frame, edge animation, `error`, and `branch_done` — plus the design-gate
  screenshots in both themes. Still untested: the **completed-investigation replay path**, the
  agents tab, cancel, and **all five stream-panel states**. The stream panel is what #243's
  verification calls a live check.
- **Known coverage debt — the replay path cannot be smoked against the demo seed as it stands.**
  `packages/@prismalens/database/prisma/seeds/demo-data.ts` writes **zero `InvestigationEvent`
  rows**, so every seeded completed investigation replays the empty right-hand branch of the
  diagram above: the canvas renders empty and there is nothing for a spec to assert. Seeding a
  canonical-event record for at least one completed investigation is the prerequisite for a
  replay spec, and should land with it rather than before it.

### J11 — Storm: alert flood → one grouped investigation

- **Entry point**: **no UI entry point.** Alerts arrive over the webhook intake; the storm becomes
  visible as an incident with N correlated alerts.
- **Routes**: surfaces across `/alerts` → `/incidents/$id` (alerts tab) → `/investigations/$id`.
- **Goal**: N alerts collapse to one incident and one investigation, which reaches a report.
- **States**: below grouping threshold; grouped (N>1 fan-out); grouping in flight; investigation
  running / completed / failed.
- **Coverage**: none of the grouping semantics. The seed contains one incident titled
  `[demo] Storm: …` and `incident-postmortem.spec.ts` asserts that string is visible — that is a
  title assertion against fixture data, not a demonstration that grouping works. **This is #225's
  target and the largest functional gap in the matrix.**

### J12 — Settings

- **Entry point**: navbar → Settings. Tab selection is a **search param** (`?tab=`), validated in
  `validateSearch` and defaulting to `ai` — so every tab is deep-linkable.
- **Route**: `/settings`, tabs `ai` | `investigation` | `integrations` | `connections` | `danger`.
- **Goal**: configure the LLM provider, per-tier investigation policy, integrations, connections;
  and reset data.
- **States**: per tab — AI provider save / test / delete credential and per-agent overrides;
  investigation policy and limits; integrations list, add, edit, delete; connections add, edit,
  **test connection**, delete, plus OAuth callback status banners; danger zone typed-confirmation
  data reset and factory reset.
- **Coverage**: the `integrations` tab is clicked and two elements asserted. **The `ai`,
  `investigation`, `connections`, and `danger` tabs are never rendered by any test** — including
  the AI-provider tab, which is the one a fresh `pl up` install must complete before anything
  investigates.

### J13 — Integration configuration

- **Entry point**: *Add Integration* → provider-specific configuration.
- **Route**: `/settings/integrations/configure`.
- **Goal**: complete a GitHub App install or an OAuth org/repo selection and land a working
  connection.
- **States**: loading orgs; loading repos; **missing connection ID** (the error case); installation
  selection; saving; save failure.
- **Coverage**: the spec asserts that one of `Configure` / `Select Installation` /
  `Missing Connection ID` is visible — a regex that passes in the success *and* error states. It
  proves the route renders something, not which state it rendered.

### J14 — Team operations & RBAC — ◻️ no surface

`TeamSettings.tsx` exists in `packages/frontend/src/components/settings/` and **is imported by
nothing** — not by the settings route, not by the barrel. It is not in the settings `TABS` array.
A repo-wide search for role or permission checks in `packages/frontend/src` returns only ARIA
attributes, shadcn table selectors, and the setup wizard's prose about the account having
"full administrative access".

**There is no RBAC in the frontend today.** Setup creates one administrator; every authenticated
user sees every surface. #268's brief asks for RBAC journeys to be enumerated — there are none to
enumerate. When multi-user RBAC lands (ADR-0011 §6, and the server-deploy half of #237's access
model), this row becomes a real journey and needs its own specs at that time, not before.

### J15 — Correlation & alert-mapping rule management — ✅ covered

- **Entry point**: *Rules* in the navbar, between *Services* and *Investigations*.
- **Routes**: `/rules?tab=correlation` and `/rules?tab=mapping` — one route, two tabs, each with
  its own list, form dialog, and test dialog. The tab lives in the URL, so a tab is linkable.
- **Goal**: see every saved rule, change one, and find out what the engine would actually do with
  an alert — without reading the database.
- **States**: the mapping table's empty state (what a fresh install sees, since the demo seed
  ships correlation rules and no mapping rules); a skeleton while the list loads; an inline error
  with *Retry* when the list query fails; the create dialog's client-side JSON validation; the
  server's duplicate-name `CONFLICT` rendered inside the dialog; a per-row *Enabled* toggle
  disabled while its write is in flight; the unmapped services banner when services lack rules;
  and inline health badges (*Healthy*, *Never matched*, *No matches*, *Disabled*) on mapping rules.
- **Coverage**: `rules-management.spec.ts` and `mapping-health.spec.ts` (#452) drive both halves
  through real endpoints — creating rules, evaluating sample alerts, toggling enabled state,
  verifying live health query counts on the Command Center's *Alert Mapping Issues* card, and
  asserting parity between the dashboard card count and the `/rules?tab=mapping` issues list.

**What the test affordance does, exactly.** `POST /correlation/test` and
`POST /alert-mapping/test` take `{ alertData }` and nothing else: they evaluate the sample against
the **saved, enabled** rule set. There is no draft-rule parameter, so there is no test-before-save
— the dialog copy says so rather than implying otherwise. Four things interact in one evaluation
(match criteria × priority order × action × time window), so here is the worked example the spec
and the dialogs both use:

Rule (the create dialog's defaults, with `action` set to `suppress`):

```json
{
  "name": "Suppress checkout noise",
  "action": "suppress",
  "priority": 0,
  "timeWindowMinutes": 60,
  "matchCriteria": { "match": { "severity": ["critical"], "source": "prometheus" } }
}
```

Sample alert (the test dialog's default):

```json
{
  "title": "Checkout latency above SLO",
  "severity": "critical",
  "source": "prometheus"
}
```

Response, as the dialog renders it:

```json
{
  "matchedRule": { "name": "Suppress checkout noise" },
  "action": "suppress",
  "reason": "Suppressed by rule: Suppress checkout noise"
}
```

Disable that rule and the same sample returns `matchedRule: null` — which the dialog renders as
*No rule matched*. That difference is the whole point of C8: the screen reports what the engine
does, not what the form said.

Correlation and mapping criteria are **not** the same shape. Correlation nests its predicates
under `match` (`tags`, `severity`, `service`, `source`); alert mapping reads a flat object
(`source`, `labels` with `*` wildcards, `tags`). A correlation rule written without the `match`
wrapper matches nothing — as two of the demo seed's own rules demonstrate.

### J16 — Approve → execute — ◻️ inert by design

`ApprovalGate.tsx` is exported by `components/canvas/index.ts` and rendered by nothing; it is not
in `InvestigationCanvas`'s `nodeTypes`. This is correct per ADR-0023 — this repository ships the
inert shell only. The e2e obligation here is the inverse of the others: a spec should eventually
assert that **no execution path exists without a verified module**, not that approval works.

### J17 — Manual authorship (demo without an alert source) — ✅ covered

- **Entry point**: `/incidents` → *Create Incident* in the page header, or the same control in
  the table's empty state (the state a `pl up` user actually lands in).
- **Routes**: `/incidents` → `CreateIncidentDialog` → `incidents.create` → `/incidents/$id` →
  `incidents.investigate` → `/investigations/$id`.
- **Goal**: get a real incident, and a real investigation of it, into an instance that has no
  alert source pointed at it.
- **States**: the empty incidents table (offers the control rather than only explaining that
  alerts will eventually arrive); submit disabled while the title is blank; a server error
  rendered inline in the dialog; the created incident showing **Alerts (0)**; *Start
  Investigation* disabled with a stated reason while no AI provider is configured.
- **Coverage**: `manual-authorship.spec.ts` drives the whole path — it fills the dialog, asserts
  the route lands on the new incident, asserts the incident has no alerts, and starts an
  investigation from it, asserting the app routes to the investigation. It also asserts the
  dialog cannot submit a blank title, and that with no AI provider *both* investigate
  affordances are disabled and state the reason (stubbed at the settings response, so the
  assertion does not depend on global provider state).

Scope note: manual **alert** creation and manual **correlation** were deliberately left unbuilt
(#286). `alerts.create` and `incidents.addAlert` still have no UI caller, and that is intentional
— hand-stitched alerts would fake a correlation the engine never ran.

## What the specs actually prove

Worth stating plainly, because "we have 5 e2e specs" and "5 journeys are covered" are different
claims and only the first is true.

The frontend wires **60 distinct mutation procedures** to UI controls. Across the six merged
specs, exactly **nine** are invoked: `postmortems.create` via the *Start Blank* button,
`incidents.create` + `incidents.investigate` via `manual-authorship.spec.ts` (#286), and
`correlation.create` / `correlation.update` / `correlation.test` / `alertMapping.create` /
`alertMapping.test` / `alertMapping.delete` via `rules-management.spec.ts` (#294). Everything
else the suite does is navigate to a URL and assert that seeded text is on the screen.

That makes the rest of the suite a **render-and-route smoke suite**: it catches white screens,
broken routes, crashed API boot, hydration failures, and data-shape regressions like #309's
pagination total. Those are real and worth having — the suite already caught a schema-invalid
seed during #316. But outside J15 and J17 it cannot catch a broken form, a mutation that 500s, a state
transition that does not stick, or a regression in any of the five stream-panel states.

Two further structural facts about the harness:

- **It binds a frontend and an API port with `reuseExistingServer: false`**, so it cannot share
  them with a running dev stack. Since #286 those ports are overridable — the defaults are still
  3000 and 3001, but `PRISMALENS_FRONTEND_PORT` and `PRISMALENS_PORT` move both the servers and
  the `baseURL`, so a run no longer has to take down `pnpm dev`:

  ```bash
  PRISMALENS_FRONTEND_PORT=3200 PRISMALENS_PORT=3201 \
    pnpm --filter @prismalens/frontend exec playwright test
  ```

  `PRISMALENS_FRONTEND_URL` moves with the frontend port automatically; it has to, or Better
  Auth rejects every sign-in from the new origin as `Invalid origin`.
- **It boots the dev topology, not the shipped one.** Two web servers (TanStack dev server on
  3000, Nest API on 3001). #237 ships `pl up` as a *single process serving the SPA and the API on
  one port*. Nothing in the current harness exercises that topology, so today's green e2e run says
  nothing about whether `pl up` serves a working app.

---

## The e2e strategy decision

### 1. Scope — smoke every journey, write-assert the paths that gate the product

**Decision: route-level smoke on every journey; a write assertion on the five journeys named below,
not on every journey that happens to have a write path; full-flow only for J11 (storm).** Not
full-flow coverage across the board.

Two definitions, because both were doing unstated work in an earlier draft of this decision:

- **Smoke** = navigate to the route (and to each of its tabs), assert the surface rendered its own
  frame — a heading, a table, or its empty state. It does **not** mean asserting the contents of
  what renders. For J7 that means the `analytics` tab **must be navigated to and asserted at
  heading level**; the four charts' data is explicitly not asserted.
- **Write assertion** = perform one mutation through the UI and assert it persisted across a
  reload. One per targeted journey, not one per mutation.

The reasoning is the repo's own gate doctrine. AGENTS.md already requires every PR touching
`packages/frontend` to ship or extend a spec covering its changed surface. That is a *growth* rule:
coverage accretes where change happens, which is where regressions actually come from. A
big-bang full-flow suite front-loads the cost, ages badly against a UI still being designed, and
duplicates what the per-PR rule will produce for free. What the per-PR rule cannot produce is a
baseline — it only covers surfaces someone happened to touch. The baseline is what this decision
buys.

**Which write paths get a baseline assertion, and which wait.** The frontend wires write paths on
nine journeys. Naming a rule and then covering five of them without saying so would leave the next
reader unable to tell what was considered from what was missed, so the disposition is exhaustive:

| Journey | Write paths | Disposition |
|---|---|---|
| J1 setup | `setup.createOwner` | **Baseline now** — nothing works if it fails, and it is untestable later without an unseeded project. |
| J4/J5 services | 9, incl. `services.create`, discovery accept/reject/ignore | **Baseline now** — the catalog is the substrate every other journey reads from. |
| J9 postmortem | `postmortems.create/update/publish/delete`, `timeline.create` | **Baseline now** (extension) — `publish` is a state transition that locks the record; a silent failure is unrecoverable by the user. |
| J11 storm | webhook intake → grouping → investigate | **Baseline now, full flow** — §3, and #238's gate depends on it. |
| J12 settings | LLM credential save/test/delete, policy + limits, connections CRUD, danger-zone resets | **Baseline now** — the AI-provider save is a hard prerequisite for any investigation running at all. |
| J6 alerts | `alerts.acknowledge`, `alerts.resolve` | **Deferred to the growth rule.** Both are single-field status flips wired inline in the route, immediately visible in the same table, with no downstream state. A user notices instantly; nothing else breaks silently. |
| J8 recommendations | `recommendations.update` (wired), `complete`/`dismiss` (hooks, no UI caller yet) | **Deferred to the growth rule.** Only one of the three is reachable from the UI today, and the tab is on C13's act-phase path (ADR-0023), so the surface is expected to change shape before a baseline spec would pay for itself. |
| J8 investigate | `incidents.investigate` | **Deferred — but only because J11 covers it.** `storm-intake.spec.ts` drives an incident to an investigation, which is the same procedure from the same surface. A second assertion would be duplication. |
| J13 integration config | `integrations.connectGitHubInstallation`, `updateConnectionConfig` | **Deferred — cannot be asserted in-process.** Both complete against live GitHub/OAuth; a stub deep enough to make the assertion meaningful would test the stub. J12's connection CRUD covers the persistence half that *is* local. |

Deferred does not mean uncovered forever — it means the per-PR growth rule picks them up the next
time someone touches that surface, rather than the baseline paying for them now.

Concretely, **five new specs on top of the six merged**, target of eleven (J17's
`manual-authorship.spec.ts` landed with #286 and J15's `rules-management.spec.ts` with #294; both
are already counted among the merged):

| Spec | Journey | Why it earns its place |
|---|---|---|
| `setup-first-run.spec.ts` | J1, J3-empty | The `pl up` first-run path. Needs an **unseeded** workspace — add a second Playwright project without `PRISMALENS_SEED_DEMO`. Covers the wizard, the empty dashboard, and the LLM-not-configured banner in one run. |
| `auth-session.spec.ts` | J2 | Bad credentials, the `?redirect` round-trip, sign-out. Cheap, and auth failures are silent-in-dev / fatal-in-prod. |
| `settings-write.spec.ts` | J12 | Save + test an LLM credential against a stub provider; toggle an investigation policy; assert it persists across reload. Renders the four never-rendered tabs as a side effect. |
| `services-write.spec.ts` | J4, J5 | Create a service; accept one discovery suggestion; assert both persist. The catalog is the substrate every other journey reads from. |
| `storm-intake.spec.ts` | J11 | #225's artifact. See §3. |

Plus **three extensions to existing specs**, not new files: postmortem *publish* (the read-only
lock) and the J7 *analytics tab* smoke into `incident-postmortem.spec.ts`, and the investigation
*stream panel* states into `alerts-investigations.spec.ts`.

Deliberately **out of scope**: the React Flow canvas's graph rendering (expensive to assert, cheap
to eyeball — the design gate covers it), the *contents* of the four analytics charts (same
reasoning; the tab itself is smoked, per the definition above), per-integration OAuth loops (they
need live third parties), and anything under J14 or J16 until those surfaces are routed.

### 2. CI tier — stay non-required, with a stated promotion trigger

**Decision: `e2e.yml` stays non-required today, and is promoted to a required check when a
specific, checkable condition is met.**

The tension is real and both horns hurt. A non-required check that nobody reads is indistinguishable
from no check. A required check on an unstable suite converts every flake into a merge block, and
this repo has one operator — a flaky blocker gets disabled, not fixed, and then the check is worse
than nothing.

The resolution is to promote on evidence rather than on preference or on a date:

> **Promotion trigger.** `e2e.yml` becomes a required check when the **last 20 `main`-branch runs
> are green and none of them consumed a Playwright retry**, *and* `storm-intake.spec.ts` (§3) has
> landed. Check the first half with
> `gh run list --workflow=e2e.yml --branch=main --limit=20`; the retry half is visible in the run
> summary (Playwright reports `N flaky` separately from `N passed`).

The retry clause matters more than the green clause. `playwright.config.ts` sets `retries: 2` in
CI, so a suite that is 30% flaky still reports green. Green-with-retries is exactly the state that
makes a required check unbearable later. **At promotion, drop `retries` from 2 to 1** so a flake
surfaces as a flake instead of hiding inside a pass.

The storm-spec clause matters because promoting a suite that cannot fail on the product's central
behavior buys governance theatre. Requiring a check that only proves pages render sets the bar in
the wrong place.

Until promotion, the non-required run is not decoration: it is where the operator reads the
uploaded `playwright-report` artifact on failure, and it is the evidence stream the promotion
trigger is computed from.

### 3. What #225 contributes — it **extends** the merged harness; it does not seed it

#268's text says #225's driving harness "should be built as the seed of the app e2e suite, not a
throwaway script." **That framing is now inverted and should be corrected: the seed already
exists.** #316 shipped it. #225's obligation is therefore stronger and simpler than the issue
states — not "build a suite," but "add one spec to the suite that already runs in CI."

**Recommendation: #225 ships `packages/frontend/e2e/journeys/storm-intake.spec.ts` and nothing
standalone.** It reuses the merged harness's isolated workspace, its auth storage state, and its
CI job. Specifically it must:

1. POST a multi-alert Alertmanager payload to the app's webhook intake — the same fixture shape
   `pl listen` consumes, not a hand-rolled one (see §5).
2. Assert the alerts land and **collapse to one incident** — N>1 fan-out, asserted on the incident
   detail's alerts tab, not in the database.
3. Drive that incident to an investigation and assert the investigation reaches a report state.
4. Assert the report renders at `/investigations/$id` with its root cause — the same
   absence-stays-absence discipline the existing culprit spec applies.

This is the one journey where full-flow coverage is justified rather than smoke: storm grouping is
the supervisor's central design, it spans four surfaces, and there is no cheaper way to prove it
runs through the app path than to run it through the app path.

A standalone driving script would duplicate the workspace isolation, the seeding, the auth, and the
CI wiring that #316 already paid for, and it would rot the moment the UI it drives changes, because
nothing would run it on every PR. If #225 finds the merged harness genuinely cannot host it, that
is a finding worth reporting — but the default is to extend.

### 4. Sequencing against #237 (`pl up`)

**Nothing here blocks #237 from being worked or merged.** #268 gates #237 on a *decision*, and this
document is that decision. Once it lands, #237 is unblocked.

Two things do need saying about what rides where:

**Rides along with #237, and is not optional:** the harness boots two web servers on ports 3000 and
3001. `pl up` serves the SPA and the API from one process on one port. A green e2e run today
therefore says nothing about whether `pl up` works. **#237 must extend `playwright.config.ts` with a
`pl up` webServer mode** — one command, one port, `baseURL` pointed at it — and run at least the
first-run spec (J1) and one read journey against it. Without that, `pl up` ships as the front door
other teams run, verified by nothing. This is a #237 deliverable, not a follow-up.

**Should land before #237 ships, though not before it merges:** `setup-first-run.spec.ts` (J1). The
`pl up` experience *is* J1 followed by J3-empty followed by J12's AI-provider tab, and all three
have zero coverage. Shipping `pl up` with an untested first-run path is the specific contradiction
of the Phase 5 gate that #268 was opened about. This is the one concrete prerequisite worth
holding the release on.

Everything else in §1 accretes through the per-PR growth rule and needs no sequencing.

### 5. #238's `listen`-deletion parity gate — what evidence satisfies it

#238 deletes `pl listen` only once the app path replaces it. The gate is capability parity, and the
issue is right that parity is an e2e claim by definition — you cannot demonstrate that two paths
behave the same by unit-testing either one.

**What satisfies the gate:** three artifacts, all living in `e2e.yml` so they keep holding.

1. **Same-fixture intake parity.** One Alertmanager payload fixture, checked in once and consumed
   by both `pl listen`'s tests and `storm-intake.spec.ts`. Parity means *same input, same
   observable outcome* — two tests written against two different hand-made payloads prove nothing.
   The app path must produce the same alert set the CLI path produces.
2. **N>1 fan-out through the app.** The storm spec's assertion from §3: N alerts in, one incident
   out, one investigation, one report — observed through the UI, which is the surface a user has.
3. **Per-alert cwd parity, asserted observably.** This is the subtle half and the one most likely to
   be waved through. `pl listen` resolves a working directory per alert; the worker uses one fixed
   cwd per process. The evidence is a storm containing alerts that name *different services*,
   producing agent executions with *distinct* cwd values — read through the API or the
   investigation's agents tab, not by inspecting the database. If the app cannot yet do this, that
   is the gate correctly holding the deletion, and the spec should be written first and land
   failing-and-skipped rather than not written.

**Not sufficient:** a one-off manual demo, a recorded transcript, or a passing test that ran once
on a branch. The deletion is permanent; the evidence has to be a check that keeps running after the
deletion lands. All three artifacts green on `main` — that is the gate.

### Cost and follow-ups

Ten specs at roughly 40–80 lines each is the steady state proposed here. The suite currently runs
13 tests in ~58 s locally; ten specs with write paths lands around 2–3 minutes, which is well
inside the CI budget and does not slow the existing gate.

The recurring cost is **selector maintenance, not spec authoring**. The merged specs select by role
and by visible text (`getByRole("heading", { name: "Services" })`, literal seeded strings), so a
copy change breaks a test that was not otherwise wrong. That is the right trade for a suite this
size — `data-testid` everywhere is its own tax — but it means the honest budget is *one spec touch
per frontend PR*, which is exactly what AGENTS.md already requires. No new standing cost is being
proposed here.

One follow-up worth filing, not blocking:

- **Firefox and WebKit projects.** Flagged as a deliberate follow-up in `playwright.config.ts`.
  Low priority for a single-tenant tool whose operators choose their own browser; revisit only if a
  rendering bug is ever reported that chromium did not catch.

## How this inventory is maintained

- A PR that **adds or removes a route** updates the coverage matrix in the same PR. A new route
  with no matrix row is an incomplete PR, the same way a new source file with no coverage threshold
  is (CONTRIBUTING.md, *Making a change*).
- A PR that **adds a spec** flips that journey's verdict. `🟦 → ✅` requires the journey's write
  path to be exercised, not just its route to render.
- A journey marked **◻️** graduates to a real row the moment its surface is routed — J14 (RBAC)
  is still one route away. J17 made exactly that trip in #286, when one control on `/incidents`
  turned it from "no surface" into the suite's first end-to-end journey; J15 made it in #294,
  when `/rules` gave C8 a surface at all.
- **Coverage is audited at each milestone**, alongside the operator's UX ledger walkthrough
  (AGENTS.md, *Frontend changes carry a design gate*). The matrix is the audit's input.
- When capabilities move in [`capabilities.md`](./capabilities.md), check whether a journey row
  moves with them. The two documents describe the same product from different angles and are
  expected to agree.
