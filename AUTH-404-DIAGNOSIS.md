# `pl up` packed artifact — auth 404 diagnosis (spike #327 / issue #237)

**Date:** 2026-08-05
**Branch:** `spike/327-packed-artifact`
**Question asked:** why did the auth controller fail to mount in the packed artifact, and is the
tsup bundling of `packages/api` the cause?

**Headline:** the auth 404 does not reproduce, and bundling is not the cause. The artifact that was
committed and written up in `SPIKE-327-EVIDENCE.md` **does not boot at all** — it dies before NestJS
starts. Every HTTP assertion in §6 of that document (health 200, static asset, SPA fallback,
`/api/docs` 200, auth 404) therefore cannot have come from that artifact. Separately, in every
configuration where the app *does* boot, the auth controller mounts correctly and sign-in returns
HTTP 200.

---

## 1. Reproduction attempt

Ran the committed tarball (`packages/cli/prismalens-0.4.0.tgz`, the one produced by commit
`2ccd2bd`) exactly as the spike's own `scripts/test-in-docker.sh` does: `npm i -g` into a clean
`node:22-slim` container, then `prismalens up`.

Result — the process exits immediately:

```
ℹ Starting PrismaLens single-origin application...
 ERROR  Failed to boot NestJS API main module from: /usr/local/lib/node_modules/prismalens/dist/api/main.js
Error: Dynamic require of "path" is not supported
    at .../dist/api/chunk-AAIPPTI5.js:12:9
    at ../../node_modules/.pnpm/@vercel+oidc@3.2.0/node_modules/@vercel/oidc/dist/token-util.js (.../dist/api/chunk-TZI77APV.js:460:24)
    at __require2 (.../dist/api/chunk-AAIPPTI5.js:15:50)
    at ../../node_modules/.pnpm/@vercel+oidc@3.2.0/node_modules/@vercel/oidc/dist/index.js (.../dist/api/chunk-JK2Z6LLA.js:170:29)
    at async Object.run (.../dist/src/cli/up.js:23:7)
```

`/health` never answers (`curl` → `000`). No Nest process ever exists, so nothing can 404 — Nest's
404 body requires a running Nest router.

The same bundle fails identically outside Docker (node 24 in the worktree), and a clean
`pnpm --filter @prismalens/api build` reproduces **byte-identical chunk hashes**
(`chunk-AAIPPTI5.js`, `chunk-JK2Z6LLA.js`, `chunk-TZI77APV.js`), so this is structural, not a stale
or corrupt tarball.

**Conclusion:** the auth-404 finding is not reproducible, and the boot log quoted in
`SPIKE-327-EVIDENCE.md` §5 is not a transcript of this artifact. (A real boot of this `main.ts`
emits ~160 `[RouterExplorer] Mapped {...}` lines, none of which appear in the quoted log.)

---

## 2. Controlled comparison: bundled vs unbundled

Method: an Express-level route probe (`app.all/get/post/...` patched before importing `main.js`)
plus Nest's own `RoutesResolver`/`RouterExplorer` boot logs. Same machine, same `node_modules`, same
environment; the only variable is whether the code went through tsup.

| | Unbundled (`nest build` tsc output, `dist/src/main.js`) | Bundled (tsup, with packaging defects fixed — see §4 Option A) |
|---|---|---|
| Boots | yes | yes |
| Controllers mounted | 29 | 29 |
| Routes mapped | 156 | 156 |
| `Mapped {/api/auth/*path, ALL}` | present | present |
| Route-table diff | — | **identical, zero lines of difference** |

Live probe against the bundled build:

```
POST /api/auth/sign-in/email  -> HTTP 200
  {"redirect":false,"token":"jAIY…","user":{"email":"admin@prismalens.dev","role":"owner",…}}
GET  /api/auth/get-session    -> HTTP 200
GET  /api/docs                -> HTTP 200
GET  /health                  -> HTTP 200
```

Static corroboration — decorator metadata survives the bundle intact. tsup 8.5.1 runs the decorator
pass through SWC, not bare esbuild, so `emitDecoratorMetadata` is honoured. From `dist/main.js`:

```js
AuthController = _ts_decorate6([
  Public(),
  Controller2("auth"),
  _ts_metadata4("design:paramtypes", [typeof AuthService === "undefined" ? Object : AuthService])
], AuthController);

AuthModule = _ts_decorate7([
  Global2(),
  Module2({ imports: [ConfigModule], controllers: [AuthController], providers: [AuthService, AuthGuard], … })
], AuthModule);
```

`@All("*path")`, `design:paramtypes`, and `AuthModule.controllers` are all present.

**Conclusion:** bundling does not break decorator metadata, `emitDecoratorMetadata`-based DI,
controller discovery, or path-to-regexp v8 wildcard matching. The leading hypothesis is disproved.
Also ruled out by the same evidence: conditional/env-gated `AuthModule` registration (it is
unconditional and mounted in both runs), tree-shaking of the controller (present in the bundle
text), and `ServeStaticModule` shadowing (it does not touch `/api/*`, and everything mounts).

---

## 3. Root cause of the artifact failing to boot

`packages/api/tsup.config.ts` sets `noExternal: [/^@prismalens\//]` to bundle the workspace closure.
tsup decides *externality* from `packages/api/package.json`'s dependency list. The transitive
dependencies of the `@prismalens/*` packages — `ai`, `@ai-sdk/*`, `@vercel/oidc`, `pino`, `zod`,
`@prisma/client`, `better-sqlite3`, … — are **not** listed there, so tsup inlined them too. That is
why `chunk-JK2Z6LLA.js` is 3.10 MB. The intent was "bundle 7 workspace packages"; the effect was
"bundle most of the dependency tree."

Three independent failures follow, each blocking the next (found by fixing them one at a time):

1. **`@vercel/oidc` is CJS with a dynamic `require("path")`.** esbuild's ESM `__require` shim throws
   `Dynamic require of "path" is not supported`. This is the failure that kills the committed
   artifact.
2. After injecting a `createRequire` shim: **`ReferenceError: __filename is not defined`** from
   another inlined CJS dependency.
3. After shimming `__filename`/`__dirname`: **`better-sqlite3`'s native binding lookup breaks** —
   it resolves relative to the bundle and searches
   `packages/api/lib/binding/node-v137-linux-x64/better_sqlite3.node`. Native `.node` addons cannot
   be bundled at all.

All three are packaging/CJS-interop failures. None is a NestJS failure.

---

## 4. Fix options

### Option A — keep tsup, scope the externalization correctly

Add `external: [/^[^./]/]` alongside `noExternal: [/^@prismalens\//]` (noExternal wins, so the
workspace packages still bundle; every other bare specifier stays external).

*Measured, not estimated:* build succeeds; output drops from `main.js` 865 KB + a 3.10 MB chunk to
`main.js` 650 KB + one 365 KB chunk; boots; full 156-route table; auth returns 200.

- **Cost:** `packages/cli/package.json` must declare the full transitive runtime closure of the
  `@prismalens/*` packages. The first pass was already missing `pino` and `zod`.
- **Risk:** that dependency list is hand-maintained and drifts silently. A missing entry surfaces
  only as a runtime `ERR_MODULE_NOT_FOUND` when the packed artifact is booted — which is exactly the
  class of bug this spike shipped.

### Option B — do not bundle the API; ship the workspace packages as real files

Have `pack-cli-artifact.sh` copy each built `@prismalens/*` package into the published package's own
`node_modules/@prismalens/<name>`. Node then resolves them normally, each package's own
`package.json` declares its own dependencies, and npm installs the closure.

- **Cost:** ~20 lines in the pack script and a per-package copy. The artifact carries 7 small
  directories instead of one bundle. Drops the `nest build && tsup` double-compile — `nest build`
  output ships directly.
- **Risk:** low. No bundler in the path means the CJS-interop, native-addon, and decorator-metadata
  risk classes disappear permanently rather than being negotiated with. The packed artifact's module
  graph becomes identical to the workspace's, so "works in dev" transfers to "works packed."

### Option C — publish `@prismalens/*` to npm as real packages

- **Cost:** release plumbing, version coordination, and changesets for 7 packages; commits us to a
  public API surface for packages that are internal today.
- **Risk:** low technically, high in process overhead. Not warranted for R1.

### Recommendation: **Option B**, with Option A as the fallback if artifact size becomes a problem.

The failure class we actually hit is bundler interop, and B removes the bundler rather than
negotiating with it. A keeps the bundler and buys a hand-maintained dependency list — precisely the
mechanism that produced this failure. B is also cheaper to verify: there is no "did the bundle
inline something it shouldn't have" question to ask.

---

## 5. Secondary defects found on the way (all still open, all in scope for #237)

1. **`tsup clean: false` + content-hashed chunk names** → `packages/api/dist` accumulates dead chunks
   from every previous build, and `pack-cli-artifact.sh` copies the whole directory. My repack
   shipped 23 chunk files where 3 were live; the tarball grew from 4.07 MB to 9.08 MB.
2. **`pack-cli-artifact.sh` also copies the tsc output tree** (`dist/src`, `tsconfig.build.tsbuildinfo`,
   `tsup.config.js`, `vitest.config.js`) into the artifact — dead weight plus a duplicate code path.
3. **`packages/cli/src/cli/up.ts` computes the static dir wrongly.**
   `path.resolve(__dirname, "../public")` — the compiled file lands at `dist/src/cli/up.js`, so this
   resolves to `dist/src/public`, which does not exist. The assets are at `dist/public`. Not
   exercised by the spike because boot never reached Nest; it would have been the next bug.
4. **`DATABASE_URL` is not an input.** `@prismalens/config` computes the database URL from
   `getAppDataDir()`, which honours only `PRISMALENS_WORKSPACE_DIR` (default `~/.prismalens`). The
   `DATABASE_URL=file:/tmp/prismalens-spike.db` exported by `scripts/test-in-docker.sh` is silently
   ignored. Any `pl up` run — including CI and any docs that tell users to set `DATABASE_URL` — hits
   the default workspace DB instead.

---

## 6. Impact on the #237 estimate

**3 active days does not hold as scoped.** The spike's evidence has to be re-run, because none of its
route-level claims are backed by an artifact that boots.

Remaining work, after the packaging shape is chosen:

| Work | Estimate |
|---|---|
| Implement the packaging shape (Option B) | 0.5d |
| Get the artifact to boot end-to-end in a clean container — native addon, Prisma engine, static dir, DB path | 1d (this is where the unknowns are) |
| Re-run the evidence honestly, with a route-table assertion | 0.5d |
| Fix the secondary defects in §5 | 0.5d |
| **Total** | **~2.5–3 active days**, on top of re-running the spike |

**Add a gate.** The `pl up` smoke check must assert that `POST /api/auth/sign-in/email` returns
non-404 and that the boot log contains the expected number of mapped routes. An artifact nobody can
log into must fail the build, not be written up as a footnote. With a global `APP_GUARD`, missing
auth routes lock every user out of the product — this is release-blocking for R1, and the only
reason it looked survivable is that the underlying artifact never ran.

---

## 7. Operator note — live dev DB was touched

`DATABASE_URL` being ignored (§5.4) had a consequence for this investigation: the diagnostic boots
ran against `~/.prismalens/prismalens.db` despite `DATABASE_URL` pointing at a scratch file. The
successful sign-in probe in §2 therefore created **one better-auth session row** in the operator's
dev database. No schema change, no deletion, no reseed — `DevSeedService` is guarded by
`NODE_ENV !== "development"` and all runs used `NODE_ENV=production`.

The correct isolation knob is `PRISMALENS_WORKSPACE_DIR`, not `DATABASE_URL`. Verified: setting it
redirects the DB and the secret files into the given directory.

---

## Method / reproduction

- Unbundled control: `node packages/api/dist/src/main.js` in the worktree (workspace module
  resolution works there).
- Bundled subject: tsup output run from a flat `node_modules` symlink farm, which reproduces the
  packed artifact's npm-style resolution without a container round-trip.
- Route tables captured two independent ways — a patched Express prototype and Nest's own
  `RouterExplorer` logs — which agree.
- `packages/api/tsup.config.ts` was modified only to *measure* Option A and has been reverted; no fix
  is committed on this branch.
