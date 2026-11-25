# Core journeys

A journey is a core behaviour of the loop (an alert in, a report out, a restart between) written once in `scripts/journeys/` as plain steps over the public HTTP API and the webhook, with no product imports. Every target runs every journey:

| Target | Runs it |
| --- | --- |
| in-process | `packages/api/test/journeys/journeys.int.spec.ts`: real SQLite and HTTP, the scripted agent |
| packed | `PACKED_INTAKE_AGENT=fake node scripts/packed-intake.mjs <tarball dir>`: the installed tarball |
| live | the same script on the pinned agent, nightly (`nightly.yml`) |

What only one target can show, such as a clock jump, a database row or what the browser draws, stays a scenario or a `.feature`.

- **Add a journey:** export a `{ name, title, timeoutMs, run(target, ctx) }` object from a file in `scripts/journeys/`, using the helpers in `lib.mjs`, and add it to `journeys` in `scripts/journeys/index.mjs`. The in-process spec and `scripts/packed-intake.mjs` pick it up; `PACKED_INTAKE_JOURNEYS=<name>` runs one. A journey asserts through `node:assert` and touches only the `Target` interface (`scripts/journeys/types.d.mts`).
- **Add a target:** implement `Target` and hand it to `runJourneys` (`scripts/journeys/index.mjs`). The in-process target is `packages/api/test/journeys/in-process-target.ts`; the packed and live targets are `scripts/journeys/targets/packed.mjs`.

