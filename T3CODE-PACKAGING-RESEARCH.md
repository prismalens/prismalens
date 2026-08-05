# t3code packaging research — does it apply to `pl up`?

Source: `pingdotgg/t3code`, cloned shallow into `.scratch/t3code` inside this worktree
(not committed — gitignored by absence of `git add`). All line/file references below are
against that clone at the commit fetched 2026-08-05.

Correction up front: **t3code is not the "create-t3-app" project.** `pnpm-workspace.yaml` /
root `package.json` name it `@t3tools/monorepo` — it's Theo/ping.gg's AI coding-agent
product ("T3 Code"), an Effect-based CLI + local server + Electron desktop app + mobile app.
That's actually the right comparison for prismalens: it ships a CLI-launched local server with
a bundled web UI, plus (per its `apps/desktop`) the same server reused inside Electron — the
exact two-channel shape cited internally.

## Part 1 — how t3code packages itself

**1. Shipped artifact.** An npm package named `t3` (`apps/server/package.json:2-9`), version
`0.0.31` at clone time, with `"bin": { "t3": "./dist/bin.mjs" }` and `"files": ["dist"]`. The
published tarball contains only `dist/`: `bin.mjs` (CLI + server), `service-launcher.mjs` (a
second bundled entry, see below), and `dist/client/` (the built web SPA, copied in as static
files — see Q3). Desktop is a **separate**, unpublished `electron-builder` artifact
(`apps/desktop/package.json`, `private: true`) that spawns the same `t3` server bundle rather
than re-implementing it.

**2. Bundling.** Yes, via `vp pack` — the `pack` command of `vite-plus`
(`pnpm-workspace.yaml` catalog: `vite: npm:@voidzero-dev/vite-plus-core@0.2.2`), a
rolldown-based bundler/pack tool from the Vite team, not tsup/esbuild directly. Config lives
in `apps/server/vite.config.ts:9-23`:

```ts
const bundledPackagePrefixes = ["@pierre/diffs", "@t3tools/", "effect-acp", "effect-codex-app-server"];
export function shouldBundleCliDependency(id: string): boolean {
  return bundledPackagePrefixes.some((prefix) => id.startsWith(prefix));
}
...
pack: {
  entry: ["src/bin.ts"],
  outDir: "dist",
  deps: { alwaysBundle: shouldBundleCliDependency, onlyBundle: false },
  banner: { js: "#!/usr/bin/env node\n" },
}
```

The critical mechanic: `alwaysBundle` is a **predicate function checked against every import
id as the bundler walks the graph**, not a lookup against `apps/server/package.json`'s own
`dependencies`. An import that doesn't match one of those four prefixes stays external
*regardless of which file imports it* — including imports made from inside an already-bundled
`@t3tools/*` package. That's why bundling `@t3tools/shared` doesn't drag in whatever `effect`
or `@anthropic-ai/claude-agent-sdk` it happens to import: those names never match the
predicate, so they stay external at every point they're encountered, with zero need to
manually mirror them into `apps/server`'s own `dependencies` list.

`apps/server/package.json` bears this out: `@t3tools/contracts`, `@t3tools/shared`,
`@t3tools/tailscale`, `@t3tools/web`, `effect-acp`, `effect-codex-app-server` are all
**devDependencies** (bundled away, never installed at runtime); real npm packages
(`@anthropic-ai/claude-agent-sdk`, `effect`, `node-pty`, `@opencode-ai/sdk`, `yaml`, three
`@effect/*` platform packages) are real `dependencies`, resolved normally by npm at install
time. No CJS/dynamic-require workaround was needed in the bundler config itself — the
predicate keeps anything CJS-flavored and hairy (their own SDKs, native addons) external by
construction rather than by patching around it after the fact.

**3. Web UI + server.** Static files, one process, one port. `apps/server/scripts/cli.ts`
(`buildCmd`, ~line 150) runs `vp pack` (`build:bundle` script) to produce `dist/bin.mjs` +
`dist/service-launcher.mjs`, then does a **plain filesystem copy**:
`fs.copy(path.join(repoRoot, "apps/web/dist"), path.join(serverDir, "dist/client"))`. There is
no JS import of `@t3tools/web` anywhere in `apps/server/src` (confirmed by grep — zero hits) —
the web app is built as an independent Vite/React app and its `dist/` output is copied
byte-for-byte into the server's own `dist/client/`. At runtime, `apps/server/src/http.ts`'s
`staticAndDevRouteLayer` (~line 220) serves that directory: SPA-style fallback to
`index.html` on any path with no file extension or a 404, `DEFAULT_PORT = 3773`
(`apps/server/src/config.ts:17`). One HTTP server, one port, API routes and static assets on
the same listener — precisely the shape prismalens wants.

The `publish` subcommand in `cli.ts` (~line 220) hard-asserts all three build outputs exist
before publishing: `dist/bin.mjs`, `dist/service-launcher.mjs`, `dist/client/index.html`.

**4. Native dependencies.** `node-pty` (terminal spawning) is a real npm `dependency` —
never bundled, resolved via its own prebuilt-binary install machinery like any other npm
consumer would get it. Notably, **t3code has no native SQLite binding at all**: its
persistence layer (`apps/server/src/persistence/NodeSqliteClient.ts`) uses Node's *built-in*
`node:sqlite` module, not `better-sqlite3`. Their `engines` field —
`"node": "^22.16 || ^23.11 || >=24.10"` — is exactly the version floor where `node:sqlite`
graduated to stable/usable. That sidesteps the entire "does the native addon have a prebuilt
binary for this OS/arch/Node ABI" problem for the DB layer entirely — there's no addon to
install.

**5. Monorepo — how internal packages reach the tarball.** Yes, it's a pnpm workspace
(`pnpm-workspace.yaml`: `apps/*`, `infra/*`, `packages/*`, ...). Internal packages
(`@t3tools/shared`, `@t3tools/contracts`, `effect-acp`, `effect-codex-app-server`,
`@pierre/diffs` — the last a scoped-in third-party fork, not internal) are **bundled into**
`dist/bin.mjs` and `dist/service-launcher.mjs` via the `alwaysBundle` predicate above. They
are never published separately and never copied as files — they exist only as inlined code
inside the two `.mjs` bundles.

**6. `prepack`/build-at-pack-time.** There's no npm `prepack`/`prepublishOnly` hook; instead
a custom `cli.ts build` / `cli.ts publish` pair (own Effect CLI, run by hand or CI) does the
work: (a) `vp pack` twice — once for `src/bin.ts`, once more with `--no-clean` for
`src/service-launcher.ts` so both land in the same `dist/` without wiping each other; (b) copy
`apps/web/dist` → `dist/client`; (c) at publish time, rewrite `package.json`'s `dependencies`
by resolving pnpm-workspace `catalog:`/`workspace:*` specifiers to concrete versions
(`resolveCatalogDependencies`), publish via `vp pm publish`, then **restore the original
`package.json`** afterward (`Effect.acquireUseRelease`) so the repo's working tree is clean
again. This exists because `apps/server/package.json`'s real `dependencies` entries are
`catalog:`-pinned inside the monorepo but must be literal semver ranges in the published
artifact.

**7. What t3code does that prismalens doesn't, and arguably should.**
- **`node:sqlite` instead of `better-sqlite3`.** This is the one clean, low-risk idea worth
  raising to the operator as a follow-up (not part of this spike): it removes an entire class
  of "does this native binding have a prebuilt for this platform" failure at global-install
  time. Caveat, stated plainly and not glossed over: prismalens's Prisma layer depends on
  `@prisma/adapter-better-sqlite3` (`packages/@prismalens/database/package.json`) — Prisma's
  driver-adapter API does not (as of the Prisma 7.x line used here) have an official
  `node:sqlite` adapter, so this is a real migration, not a config flip. Flagging as a
  discussion candidate, not recommending action now.
- **Publish-time dependency-version rewrite with automatic restore.** Prismalens doesn't need
  this today (no `catalog:` specifiers get published raw), but the "mutate `package.json` for
  publish, guarantee restore even on failure" pattern is a clean one if catalog-range
  dependencies ever leak toward publish.
- **Predicate-based bundling, not manifest-based.** This is the one genuinely load-bearing
  idea — covered in Part 2(a) below.

## Part 2 — the two open questions

### (a) Is `noExternal: [/^@prismalens\//]` standard practice or a smell?

Bundling the first-party workspace closure into the one published package **is** standard
practice for shipping a monorepo CLI/tool to npm — t3code does it, and it's the same thing
`packages/cli/tsup.config.ts` already does successfully (v0.4.0 is published, `packed-smoke.sh`
proves no `@prismalens/*` leaks into the tarball). So the setting itself isn't the smell.

The scaling problem is a specific, well-defined difference in *how the two tools decide what's
external*, and I can point to exactly why it worked for `cli` and not for `api`:

- **tsup/esbuild's externality check is anchored to the entry package's own
  `package.json`.** Concretely: `packages/cli/package.json`'s `dependencies` list
  (`@ai-sdk/anthropic`, `@ai-sdk/google`, `ai`, `@anthropic-ai/claude-agent-sdk`, `zod`, ...)
  is not just CLI's own direct deps — it is **manually hoisted to also cover the transitive
  runtime deps of `@prismalens/engine`, `@prismalens/config`, `@prismalens/contracts`**, which
  are devDependencies of `cli` and get bundled by `noExternal`. Someone had to notice that
  `@prismalens/config` depends on `ai` + every `@ai-sdk/*` provider
  (`packages/@prismalens/config/package.json`) and copy those names up into `cli`'s own
  `dependencies` so tsup would find them declared and mark them external instead of bundling
  them. That's a **manual, silent synchronization requirement** — nothing enforces it; if
  `@prismalens/engine` picked up a new third-party dependency tomorrow without a matching
  bump to `cli`'s `dependencies`, the exact `api` failure would recur in `cli`.
- **`api` never got that manual hoist**, because the deps in question are one hop further
  away: `@prismalens/config` carries `ai`/`@ai-sdk/*`; `@prismalens/database` carries
  `@prisma/client` + `@prisma/adapter-better-sqlite3` (→ `better-sqlite3`, a native addon);
  `@prismalens/auth` carries `better-auth` (→ `@vercel/oidc` transitively); `@prismalens/logger`
  carries `pino`. None of those third-party names are declared in `packages/api/package.json`
  itself — `api`'s own `dependencies` list is Nest/oRPC/queue packages plus the five
  `@prismalens/*` workspace packages, nothing else. tsup, finding those transitive names
  absent from `api`'s manifest, bundled them by default — including `better-sqlite3` (can't be
  bundled at all — native `.node` addon) and `@vercel/oidc` (dynamic `require()` that esbuild
  can't statically resolve, the literal crash reported).

- **What t3code (and comparable tooling) do instead: decide externality per import
  specifier during the bundle graph walk, not by manifest lookup.** `vite-plus`'s
  `deps.alwaysBundle` predicate is exactly that — checked against every id encountered,
  including ids imported from inside an already-bundled package, so a transitive dependency of
  a bundled package that isn't itself first-party stays external automatically, with no
  manual list to keep in sync. Plain esbuild supports the equivalent via an `onResolve` plugin
  hook (mark anything not matching `/^@prismalens\//` `external: true`); tsup's own
  `noExternal`/manifest-membership heuristic is the layer that's missing this. This is a real,
  known tsup/esbuild footgun for exactly this monorepo-bundling shape, not something specific
  to prismalens's setup.

- **A third, different-in-kind option — don't bundle at all, copy the built packages'
  files into `node_modules`.** This sidesteps the manifest-vs-predicate question entirely by
  never asking a bundler to make an externality decision. See the finding below: this is
  already validated, live, for `packages/api` specifically, on a concurrent branch in this
  repo. It also avoids a risk t3code's own approach doesn't have to deal with: t3code's server
  is an Effect `Command`/`HttpApi` app with no reflection-based DI, so bundling its own source
  with esbuild is safe. **NestJS's DI relies on TypeScript's `emitDecoratorMetadata`
  (`design:paramtypes` reflection), which esbuild's TS transform does not emit** — esbuild
  deliberately skips full type-checking for speed, and decorator-metadata emission requires
  it. Bundling `api`'s own decorated controller/service source with tsup/esbuild (as the prior
  failed attempt did — `entry: ["src/main.ts"]`, bundling the raw Nest source, not just its
  workspace deps) risks silently broken constructor injection on top of the dynamic-require
  crash that was actually hit. This is a second, deeper reason not to chase the t3code
  bundling model for `api` specifically, independent of the manifest-vs-predicate issue.

**Concrete finding — this has already been re-tested, live, in this repo, since this task
started.** `git log --all` surfaces two local spike branches on issue #327 (packaging):
`spike/327-packed-artifact` (the original failed attempt this task describes — commit
`2ccd2bd`, `packages/api/tsup.config.ts` with `entry: ["src/main.ts"]` and
`noExternal: [/^@prismalens\//]`, i.e. bundling `api`'s own Nest source directly) and a newer
`spike/327-rerun-option-b`, evidently from a parallel in-flight agent, whose latest commit
(`45bf362`, "finalize evidence log for verified option B container run") lands **Option B: no
bundling of `api` or the `@prismalens/*` packages at all.** `scripts/pack-option-b.sh`
(on that branch) builds each package normally (`nest build` / `tsc`, no esbuild touching
decorated Nest source), then assembles the tarball by copying: each `@prismalens/*` package's
`dist/` + `package.json` into `packages/cli/node_modules/@prismalens/<name>`, `api`'s `dist/`
into `dist/api`, `frontend`'s built SPA into `dist/public`, `worker`'s `dist/` into
`dist/worker`, plus the generated Prisma client and migration SQL. `SPIKE-327-RERUN-EVIDENCE.md`
on that branch records a **real, verified clean-container boot**: 156 `[RouterExplorer] Mapped`
lines, plus passing HTTP round-trips for `/health`, static asset serving, SPA fallback,
`/api/docs`, `POST /api/auth/sign-in/email` (real cookie-based session), an authenticated
`GET /api/incidents` call, a 404 on `/api/nonexistent` proving `/api/**` isn't swallowed by the
SPA fallback, and a working webhook POST. That is direct evidence Option B is not just
theoretically sound but already works for this exact codebase.

**Verdict:** `noExternal` on a bundler is standard practice for the *CLI's own shallow
closure*, but it's the wrong tool for `api`'s shape specifically — both because tsup's
manifest-anchored externality check doesn't scale past one hop without manual upkeep, and
because bundling NestJS's own decorated source with esbuild is independently risky. The
practice comparable projects actually reach for at this depth is **not bundling** — either
t3code's predicate-based bundler config (viable in principle, not proven safe for
decorator-metadata code), or the copy-built-packages-into-`node_modules` shape (Option B,
already proven for `api` on the sibling branch), or its off-the-shelf equivalent:
**`pnpm deploy`** (confirmed present, `pnpm --filter=<project> deploy <target-dir> [--prod]`,
still labeled "Experimental!" in `pnpm 10.27.0`'s own `--help` text). `pnpm deploy` does
natively what `pack-option-b.sh` does by hand — materialize a workspace package's resolved
dependency graph, including workspace packages, into a real `node_modules` — and would remove
the hand-rolled copy script's per-package special-casing (e.g. the `database` package's
`prisma/generated` and `prisma/sqlite` directories are copied by name in the script; a stock
`files` field in `@prismalens/database/package.json` might let `pnpm deploy` do it generically).
Worth evaluating as a follow-up once Option B's approach is accepted, given its "Experimental"
label deserves scrutiny before depending on it for a release artifact.

### (b) Moving `packages/cli` "outside the `@prismalens` dir"

Checked the current layout directly: `packages/cli`, `packages/api`, `packages/frontend`, and
`packages/worker` are **already** siblings at the top of `packages/`. The shared libraries
(`auth`, `config`, `contracts`, `database`, `design-tokens`, `engine`, `integrations`,
`logger`) live under `packages/@prismalens/*`, one level deeper. There is nothing to move —
`cli` is not inside `packages/@prismalens/`.

The mechanical point the brief asked me to confirm is also correct: `noExternal: [/^@prismalens\//]`
matches on the **import specifier / package name** (the string after `@prismalens/` in
`import ... from "@prismalens/engine"`), which is `packages/@prismalens/engine/package.json`'s
`"name"` field — completely independent of which directory that package's source lives in on
disk. Moving directories around changes nothing the regex sees. The only way to change what
gets matched is renaming packages (e.g. dropping the `@prismalens/` npm scope from the shared
libs), which is a materially bigger, riskier change than a directory move and wasn't asked for.

**What the operator's idea would achieve:** nothing, as literally stated — the layout it
describes already exists.
**What it would not achieve:** it would not have prevented, and has no bearing on, the `api`
bundling failure — that failure is about the bundler's externality algorithm and package
*names*, not directory structure.

## Part 3 — spike: not run, and here's why

The brief's bar for a spike was: t3code's approach must be "genuinely transferable" and
testable "well under an hour," with a real clean-container boot as proof if attempted. Two
things surfaced during research make running that spike the wrong use of the time budget:

1. **t3code's actual mechanism doesn't transfer cleanly to `packages/api`.** It's a
   bundling-based approach (`vp pack`, predicate-based externals) applied to Effect
   `HttpApi`/`Command` code with no decorator-metadata DI. `api` is NestJS, whose DI depends on
   `emitDecoratorMetadata`, which esbuild (the engine under both tsup and `vite-plus`'s `pack`)
   does not emit. Reproducing t3code's predicate-based-external technique with a tsup/esbuild
   plugin is mechanically easy (an `onResolve` hook marking anything outside
   `/^@prismalens\//` as external) — but proving it's *safe* for `api` would require bundling
   `api`'s own decorated source and verifying dependency injection isn't silently wrong, which
   is a correctness question, not a bundling-mechanics one, and not answerable in an hour.
2. **A parallel spike on this exact issue, in this exact repo, already ran the safer
   alternative to completion with verified evidence.** `spike/327-rerun-option-b`
   (commit `45bf362`, `SPIKE-327-RERUN-EVIDENCE.md`) shows a clean-container boot of
   `packages/api` with **156 `[RouterExplorer] Mapped` route lines** and working HTTP
   round-trips (auth sign-in with a real session cookie, static SPA serving, SPA fallback,
   webhook POST, 404 on unmatched API routes) using the "copy built packages into
   `node_modules`, don't bundle `api`'s own source at all" shape. Re-running a t3code-flavored
   bundling spike against the same target, from scratch, in a sibling worktree, would
   duplicate work already done — and would very likely hit the same BullMQ/ioredis
   connection-retry issues that branch's commit history shows it had to debug and fix
   (`c877156`, `8e6958f`) before reaching a clean boot, which is not "well under an hour" work.

Given both, I did the one additional check that was genuinely cheap and additive —
confirming `pnpm deploy` exists and does natively what that branch's hand-rolled
`pack-option-b.sh` does manually — and stopped there rather than re-deriving a result that
already exists with stronger evidence than I could produce solo inside the time budget.

## Recommendation

Don't chase t3code's bundling model for `packages/api` — its enabling condition (no
decorator-metadata DI) doesn't hold here, and a parallel spike already validated the
approach that respects that constraint: build `api` and the `@prismalens/*` packages normally
(`tsc`/`nest build`, no bundler touching decorated source), then assemble the tarball by
copying each built package's `dist/` + `package.json` into `node_modules/@prismalens/<name>`
rather than trying to inline them. `packages/cli`'s existing `noExternal` bundling is fine to
keep as-is — its closure is genuinely shallow and its manual dependency-hoisting has, so far,
been kept in sync — but it should be treated as a known-fragile pattern (nothing enforces the
hoist) rather than a template to extend to `api` or `worker`. The one idea worth a real
follow-up conversation with the operator, separate from this spike, is dropping
`better-sqlite3` for `node:sqlite` to remove the native-addon-on-global-install risk
entirely — flagged, not actioned, since it's a genuine Prisma-driver-adapter migration.
Coordinate with whoever owns `spike/327-rerun-option-b` before starting any further
packaging work on `api`, since it's already ahead on the actual fix.
