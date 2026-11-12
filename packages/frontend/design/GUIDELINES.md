# App guidelines

The app's counterpart to the site's `design/GUIDELINES.md` in `prismalens/prismalens.io`. It inherits that file's Look, Motion and states, and Accessibility rules (its rules 8 to 15) and its token sync; this file says where the app differs and why. Rules marked **[check]** name the check that fails when they break; the rest are **[judgement]** and are held by review (see `JUDGE.md`).

Run before a UI PR: `pnpm ui:check:static` (seconds), and `pnpm ui:check` when you change a screen (it runs the design matrix and holds it to `ui-budget.json`).

## Words

1. **Vocabulary.** A *thread* is any conversation with an agent, whoever started it. A *trigger* is what started it: you, an alert, a webhook or a schedule. A *run* is one agent session inside a thread; a *report* is what a run concludes. A *service* is a repository the agent can read plus the alerts that belong to it; a *project* is code without alert routing. Never "incident" for a thread the user started; never "investigation" in copy where "run" will do. [judgement]
2. **Only alerts fire.** A webhook event *arrives*; a schedule *runs*. Firing words, impact charts and alert history belong to monitoring sources only (`lib/trigger.ts` `isEvent`). [check: unit tests in `lib/incident-summary.test.ts`]
3. **Copy budget.** Empty-state and status strings are five words or fewer. [check: `scripts/ui-gates.sh`] A sentence says what happened and what to do next, in that order; a count comes before the name it counts, so truncation cuts the name, never the verb. [judgement]
4. **No AI tells:** no em dashes, sparkles, trailing arrows or uppercase mini-headings in UI text. [check: `scripts/ui-gates.sh`]
5. **Every user-facing string a PR adds or changes is listed in its body.** [judgement, PR checklist]

## Attention

6. **One state per row.** A sidebar row shows its title and one trailing mark in a 16 px slot: failed, ready, working, or the trigger's glyph. The words live in the hint. [check: `ThreadRowView.test.tsx`]
7. **One thing calls for attention.** Waiting for you (approvals) sits above Recents; the board's *To look at* groups are ordered by what needs the user. Colour marks state, never decoration. [judgement]
8. **A finding is qualified where it is stated.** A cause that rests on code alone says so beside it; "likely" is never dropped. [judgement]

## Shell

9. **Layout contract.** The sidebar: New and Search, then the doors (Threads, Automation, Services, and Operations once alerts have arrived), Waiting for you, Recents, Settings at the foot. It never changes per page; Settings keeps it and lists its sections inside the page. Below 1280 px it folds to a labelled rail; on a phone it is a Menu drawer. [check: `Sidebar.test.tsx`, design matrix]
10. **One page header** (`shell/PageHeader`, or `run/IncidentHeader` on a thread). Pages do not build their own top bar. [check: Biome plugin `one-page-header`]
11. **The thread page is transcript first.** A thread with a run opens on its transcript; an incident thread keeps a compact summary above it (service, whether the alert still fires, the brief, Next). Detail lives in the right panel's Incident tab, which never opens by itself. Completion never moves a reader, steals focus or opens a panel. [check: e2e `overview.spec.ts`, `incident-record.spec.ts`; the rest judgement]
12. **The agent's words lead.** Tool calls fold to one quiet line per group and open on click, on a waiting approval, or on a link; once opened they stay open. [check: `Transcript.test.tsx`]

## Look, motion and accessibility

13. **Tokens only** (site rule 8). Colours come from `styles/tokens.css`; the site syncs from it. [check: Biome plugin `token-colours` and `nursery/noTailwindRawColors`]
14. **Edges are hairlines, not borders.** Structure comes from surface steps and a one-pixel `after:` hairline. [check: Biome plugin `hairline-edges`; `lint-look.sh` for stylesheets]
15. **One spinner: the ring** (`shared/Ring`, site rules 11 and 12; `shared/RingTick` when the work ends in a tick or a cross), and every async surface has a loading, content and empty or failed state. [check: Biome plugin `one-spinner`]
16. **Reduced motion shows the final state** (site rule 14). [check: design matrix frame `frames-live-reduced`]
17. **Accessibility floor** (site rule 15, plus): AA contrast, a visible focus ring on every control, targets at least 24 px (48 px on the phone strip), no sideways scroll at 390 px except a row marked `data-scroll-x`. [check: design matrix via `ui-budget.json`]

Where the app differs from the site: no glow or translucent header (a work surface, not a showcase), and the copy budget is five words for empty and status strings rather than the site's hero budget.

## Shared components

Use these instead of building a variant; their file headers state their one constraint.

| Need | Component | Enforced by |
| :- | :- | :- |
| Empty, loading or failed state | `shared/State` (`Empty`, `Loading`, `Problem`, `Blank`) | judgement |
| Page top bar | `shell/PageHeader`, `run/IncidentHeader` | Biome plugin `one-page-header` |
| Thread row and its mark | `shell/ThreadList` (`ThreadRowView`, `RowMark`) | `ThreadList.test.ts` |
| What started a thread | `run/TriggerCard` | `trigger-card.spec.ts` |
| Working indicator | `shared/Ring` | Biome plugin `one-spinner` |
| Composer | `thread/Composer` (Home wraps it in `home/HomeComposer`) | judgement |
| Search palette (Ctrl K) | `shell/SearchHost` | `ThreadSearch.test.tsx` |

The plugins live in `biome-plugins/`, one rule each with its reason in the file header; Biome reports them with its own rules. Each plugin's `includes` in `biome.json` excludes the files that still break it. That list only shrinks; a new exclusion names its reason in the PR.

**Shared components keep their look** [check: `nursery/noTailwindRestyledComponents`, a warning until today's 288 restyles are cleared, then an error]: classes on a design-system component change its layout only; links, hints and icons pass classes through. `nursery/useTailwindStaticClassStrings` keeps every class string static so Tailwind and the rules can read it.

## Recipes

- **A new trigger kind:** add it to `TriggerKind`, `TRIGGER_WORD` and `ALERT_SOURCES` (or not) in `lib/trigger.ts`, its glyph in `TRIGGER_ICON`, its word in `ORIGIN_WORD`; add a design-matrix state that shows it; run `pnpm ui:check`.
- **A new page:** a route under `routes/_authenticated/`, `PageHeader` with its title, a door only if it is a top-level destination (then a `RAIL_LABEL` and a phone-menu row come with it), and a design-matrix state at every width.
- **A new empty state:** `Blank` or `Empty` from `shared/State`, five words or fewer, and one action that fills the state.
