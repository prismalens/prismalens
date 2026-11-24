# App guidelines

The app's counterpart to the site's `design/GUIDELINES.md` in `prismalens/prismalens.io`. It inherits that file's Look, Motion and states, and Accessibility rules (its rules 8 to 15); this file says where the app differs. Judgement rules are held by review (`JUDGE.md`); the rest are held by a check.

Before a UI PR, run `pnpm --filter @prismalens/frontend ui:check:static` (seconds), and `pnpm --filter @prismalens/frontend ui:check` when a screen changes. `ui:check` runs the design matrix and holds it to `ui-budget.json`: per state, `contrastFails`, `smallTargets`, `clipped`, `sideways`, `consoleErrors`, `otherAxe` (axe findings besides contrast) and `controls` (visible controls) may not rise; `rules` records the thresholds the matrix uses. Raise a ceiling only with the reason in the PR.

## Judgement rules

1. **Vocabulary.** A *thread* is any conversation with an agent, whoever started it. A *trigger* is what started it: you, an alert, a webhook or a schedule. A *run* is one agent session in a thread; a *report* is what a run concludes. A *service* is a repository the agent can read plus the alerts that belong to it; a *project* is code without alert routing. Never "incident" for a thread the user started; never "investigation" in copy where "run" will do.
2. **A sentence says what happened and what to do next**, in that order. A count comes before the name it counts, so truncation cuts the name, never the verb.
3. **One thing calls for attention.** Needs you sits above the threads with its full count. Colour marks state, never decoration.
4. **A finding is qualified where it is stated.** A cause that rests on code alone says so beside it; "likely" is never dropped.
5. **The sidebar is the thread list**, the same on every page: New and Search, the doors (Triggers, Projects, Operations once alerts have arrived), then Needs you, Pinned, Threads and a folded Settled group, Settings at the foot. There is no Threads page; `/threads` goes Home. Below 1280 px it folds to a labelled rail whose Threads opens the list in a sheet; on a phone it is a Menu drawer.
6. **The thread page is transcript first.** A thread with a run opens on its transcript; an incident thread keeps a compact summary above it. Detail lives in the right panel, which never opens by itself. Completion never moves a reader, steals focus or opens a panel.
7. **Every async surface has a loading, content and empty or failed state.**
8. **The app differs from the site:** no glow or translucent header, and empty and status strings stay at five words.

## Enforced rules

Plugin headers cite these numbers.

9. Empty-state text is five words or fewer: `scripts/ui-gates.sh`.
10. No em dashes, sparkles, trailing arrows or uppercase mini-headings: `scripts/ui-gates.sh`.
11. Only alerts fire (a webhook event arrives, a schedule runs): `lib/trigger.ts` `isEvent`, tested in `lib/incident-summary.test.ts`.
12. One status per row, from `thread-status.ts` in `@prismalens/contracts`: `ThreadRowView.test.tsx`, `lib/thread-list.test.ts`.
13. Tokens only, from `styles/tokens.css`: Biome plugin `token-colours.grit` and `nursery/noTailwindRawColors`.
14. Edges are hairlines, not borders: `hairline-edges.grit`, `scripts/lint-look.sh`.
15. One spinner, `shared/Ring` (`shared/RingTick` when the work ends in a tick or a cross): `one-spinner.grit`.
16. One page header, `shell/PageHeader` or `run/IncidentHeader`: `one-page-header.grit`.
17. Tool calls fold to one line per group: `Transcript.test.tsx`.
18. Reduced motion shows the final state: design matrix frame `frames-live-reduced`.
19. AA contrast, a visible focus ring, targets of 24 px (48 px on the phone strip), no sideways scroll at 390 px except a row marked `data-scroll-x`: design matrix with `ui-budget.json`.

Plugins live in `biome-plugins/`, one rule each. A plugin's `includes` in `biome.json` excludes the files that still break it; that list only shrinks, and a new exclusion names its reason in the PR. `nursery/noTailwindRestyledComponents` keeps classes on a design-system component to layout only.

## Shared components

Use these instead of building a variant; their file headers state their one constraint.

| Need | Component |
| :- | :- |
| Empty, loading or failed state | `shared/State` (`Empty`, `Loading`, `Problem`, `Blank`) |
| Page top bar | `shell/PageHeader`, `run/IncidentHeader` |
| Thread row and its mark | `shell/ThreadTree` (`ThreadTreeView`, `StatusMark`) |
| What started a thread | `run/TriggerCard` |
| Working indicator | `shared/Ring` |
| Composer | `thread/Composer` (Home wraps it in `home/HomeComposer`) |
| Search palette | `shell/SearchHost` |

## Recipes

- **A new trigger kind:** add it to `TriggerKind`, `TRIGGER_WORD`, `TRIGGER_ICON` and `ORIGIN_WORD` in `lib/trigger.ts` (`ALERT_SOURCES` if alerts use it), plus a design-matrix state that shows it.
- **A new page:** a route under `routes/_authenticated/`, `PageHeader` with its title, a door only if it is a top-level destination, and a design-matrix state at every width.
- **A new empty state:** `Blank` or `Empty` from `shared/State`, five words or fewer, and one action that fills the state.
