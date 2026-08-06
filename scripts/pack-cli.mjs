#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Build the single published npm tarball (`prismalens`) that `pl up` boots from.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT EXISTS — copy, don't bundle (issue #237, spike #327)
 * ---------------------------------------------------------------------------
 * The obvious approach — point tsup at `packages/api` with
 * `noExternal: [/^@prismalens\//]` — is BANNED and must never be reintroduced.
 * tsup/esbuild decides externality from the ENTRY package's own manifest, not
 * from a recursive per-import predicate. So inlining the first-party closure
 * also inlines that closure's THIRD-PARTY dependencies: `ai`, `@ai-sdk/*`,
 * `@vercel/oidc`, `pino`, `zod`, `@prisma/client`, `better-sqlite3`. The
 * measured result was a 3.10 MB chunk that died with `Dynamic require of
 * "path" is not supported`, then `__filename is not defined`, then a
 * `better-sqlite3` native-binding failure. Native `.node` addons cannot be
 * bundled at all. So we removed the bundler instead of negotiating with it.
 *
 * Each first-party package is COPIED, already built, into the published
 * package's own `node_modules/@prismalens/<name>`, and Node resolves it the
 * ordinary way.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DEPENDENCY UNION IS GENERATED — the hoist copying does NOT remove
 * ---------------------------------------------------------------------------
 * Copying moves the failure; it does not delete it. We copy each package's
 * BUILT OUTPUT, never its `node_modules`. So when the copied
 * `@prismalens/engine` does `import { generateText } from "ai"`, Node walks
 * UPWARD out of `node_modules/@prismalens/engine/` and looks for `ai` in the
 * PUBLISHED package's `node_modules`. Nothing put it there.
 *
 * Therefore the transitive third-party closure of every copied package must
 * appear in the published manifest's own `dependencies`. That is a hoist —
 * exactly the unenforced manual sync that already broke once (#193, see the
 * comment in `packages/cli/tsup.config.ts`). A hand-written list drifts; a
 * checker that compares against a hand-written list drifts in what it checks.
 * So the union is COMPUTED here, every pack, and two invariants FAIL the pack:
 *
 *   1. two copied packages ask for incompatible ranges of the same dependency;
 *   2. a copied package's built output imports a third-party package that is
 *      not in the computed union.
 *
 * ---------------------------------------------------------------------------
 * THE INSTALLED LAYOUT — what the user ends up with
 * ---------------------------------------------------------------------------
 *
 *   <prefix>/lib/node_modules/prismalens/
 *   |
 *   +-- package.json ................ GENERATED manifest: dependencies = the
 *   |                                 computed third-party union (literal
 *   |                                 semver, no `catalog:` / `workspace:`),
 *   |                                 bundleDependencies = every @prismalens/*
 *   |                                 below, engines.node = ">=24".
 *   +-- dist/
 *   |   +-- bin/prismalens.js ....... the `pl` / `prismalens` bin (tsup)
 *   |   +-- src/cli/up.js ........... `pl up` — boots the API in-process
 *   |
 *   +-- node_modules/               <-- BUNDLED (npm strips node_modules from a
 *       |                               tarball unless the packages are named
 *       |                               in bundleDependencies; that mechanism
 *       |                               is load-bearing and is asserted below)
 *       +-- @prismalens/
 *       |   +-- api/
 *       |   |   +-- dist/src/main.js ......... NestJS entry, imported by `pl up`
 *       |   |   +-- public/index.html ........ the SPA, served single-origin
 *       |   +-- worker/dist/index.js ......... forked once per investigation
 *       |   +-- database/
 *       |   |   +-- dist/prisma/generated/ ... Prisma 7 generated client
 *       |   |   +-- prisma/sqlite/schema/ .... migration SQL, applied at boot
 *       |   +-- engine|config|contracts|auth|logger|integrations|design-tokens
 *       |
 *       +-- ai/ zod/ pino/ @nestjs/* @prisma/* better-sqlite3/ ...
 *                                       ^
 *                                       | INSTALLED BY npm from the generated
 *                                       | union. This is where every copied
 *                                       | package's bare imports resolve to,
 *                                       | because resolution walks UPWARD.
 *
 * Read that bottom arrow as the whole design: copied packages -> upward
 * resolution -> generated union. Break any one of the three and the artifact
 * fails in a stranger's install with `ERR_MODULE_NOT_FOUND`, never here.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/pack-cli.mjs [--skip-build] [--out <dir>] [--publish]
 *                             [--publish-dry-run]
 *
 * The repo's manifest at `packages/cli/package.json` is NEVER mutated: the
 * rewritten manifest is materialised in a throwaway staging directory
 * (`packages/cli/.pack-staging`) that `npm pack` runs against. Publishing goes
 * through the very tarball this script produced and the smoke gate verified —
 * `pnpm publish -r` is not used, because pnpm's bundleDependencies handling has
 * historically diverged from npm's and would not reproduce this tarball.
 */

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CLI_DIR = join(ROOT, "packages", "cli");
const STAGING = join(CLI_DIR, ".pack-staging");

/** The node floor of the published package. See ENGINES below. */
const ENGINES_NODE = ">=24";

/**
 * `better-sqlite3` is a native addon: a caret range that floats onto a version
 * whose prebuilds lag the Node 24 ABI turns `npm i -g prismalens` into a
 * compile-from-source (and a failure on any machine without a toolchain).
 * Pinned exactly, bumped deliberately, verified by the packed smoke.
 */
const PINNED = {
	"better-sqlite3": "12.11.1",
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : argv[i + 1];
};

const OUT_DIR = resolve(ROOT, opt("--out", join(CLI_DIR, "dist-pack")));

function fail(message) {
	console.error(`\nPACK FAIL: ${message}\n`);
	process.exit(1);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function run(cmd, args, cwd = ROOT) {
	execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Workspace model
// ---------------------------------------------------------------------------

/** Parse the `catalog:` block of pnpm-workspace.yaml into {name: range}. */
function loadCatalog() {
	// `yaml` is a direct dependency of packages/cli, so it always resolves from
	// there after an install — no new root devDependency for one small parse.
	const require = createRequire(join(CLI_DIR, "package.json"));
	const { parse } = require("yaml");
	const doc = parse(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"));
	const catalog = doc?.catalog;
	if (!catalog || typeof catalog !== "object") {
		fail("pnpm-workspace.yaml has no `catalog:` block to resolve against");
	}
	return catalog;
}

/** Every workspace package, keyed by its npm name. */
function loadWorkspace() {
	const dirs = [];
	const packagesDir = join(ROOT, "packages");
	for (const entry of readdirSync(packagesDir)) {
		const full = join(packagesDir, entry);
		if (!statSync(full).isDirectory()) continue;
		if (entry === "@prismalens") {
			for (const inner of readdirSync(full)) {
				const innerFull = join(full, inner);
				if (statSync(innerFull).isDirectory()) dirs.push(innerFull);
			}
		} else {
			dirs.push(full);
		}
	}
	const byName = new Map();
	for (const dir of dirs) {
		const manifestPath = join(dir, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = readJson(manifestPath);
		byName.set(manifest.name, { dir, manifest });
	}
	return byName;
}

/**
 * Resolve a dependency specifier to a literal semver range.
 * `catalog:` -> the workspace catalog entry. `workspace:*` -> the sibling's
 * own version. Anything else is already literal.
 */
function resolveSpec(name, spec, catalog, workspace) {
	if (typeof spec !== "string")
		fail(`dependency ${name} has a non-string spec`);
	if (spec.startsWith("catalog:")) {
		const named = spec.slice("catalog:".length);
		if (named && named !== "default") {
			fail(`named catalog "${named}" for ${name} is not supported by the pack`);
		}
		const range = catalog[name];
		if (!range)
			fail(`${name} uses \`catalog:\` but is absent from the catalog`);
		return range;
	}
	if (spec.startsWith("workspace:")) {
		const pkg = workspace.get(name);
		if (!pkg)
			fail(`${name} uses \`workspace:\` but is not a workspace package`);
		return pkg.manifest.version;
	}
	return spec;
}

// ---------------------------------------------------------------------------
// 1. Which first-party packages get copied
// ---------------------------------------------------------------------------

/**
 * The copy set is the transitive closure over WORKSPACE-INTERNAL dependency
 * edges from the roots. It is derived, never listed: adding a workspace
 * dependency to the API automatically pulls that package into the tarball.
 */
function collectCopyClosure(roots, workspace) {
	const seen = new Set();
	const queue = [...roots];
	while (queue.length) {
		const name = queue.shift();
		if (seen.has(name)) continue;
		const pkg = workspace.get(name);
		if (!pkg) fail(`copy closure references unknown workspace package ${name}`);
		seen.add(name);
		for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
			if (workspace.has(dep)) queue.push(dep);
		}
	}
	return seen;
}

// ---------------------------------------------------------------------------
// 2. The generated third-party union
// ---------------------------------------------------------------------------

/**
 * Union of `dependencies` across every copied package plus the CLI's own.
 * A single dependency requested at two different ranges FAILS the pack — the
 * published package has exactly one `node_modules`, so "pick one" would be a
 * silent downgrade for whichever package lost.
 */
function computeUnion(copied, workspace, catalog, cliManifest) {
	const union = new Map(); // name -> {range, requiredBy: []}
	const add = (name, spec, requiredBy) => {
		if (workspace.has(name)) return; // first-party: copied, never installed
		const range = resolveSpec(name, spec, catalog, workspace);
		const existing = union.get(name);
		if (!existing) {
			union.set(name, { range, requiredBy: [requiredBy] });
			return;
		}
		if (existing.range !== range) {
			fail(
				`version-range conflict for "${name}": ` +
					`${existing.requiredBy.join(", ")} want ${existing.range}, ` +
					`${requiredBy} wants ${range}. Reconcile them (the catalog is the ` +
					`right place) — the published package has one node_modules and ` +
					`cannot satisfy both.`,
			);
		}
		existing.requiredBy.push(requiredBy);
	};

	for (const [name, spec] of Object.entries(cliManifest.dependencies ?? {})) {
		add(name, spec, "prismalens");
	}
	for (const name of copied) {
		const { manifest } = workspace.get(name);
		for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
			add(dep, spec, name);
		}
	}

	for (const [name, pin] of Object.entries(PINNED)) {
		if (union.has(name)) {
			union.get(name).range = pin;
		} else {
			union.set(name, { range: pin, requiredBy: ["pack-cli.mjs (pinned)"] });
		}
	}

	return union;
}

// ---------------------------------------------------------------------------
// 3. Staging the copy
// ---------------------------------------------------------------------------

const NOISE = [/\.tsbuildinfo$/, /\.map$/, /\.d\.ts$/, /\.d\.mts$/];
const TESTS = [/\.test\.[cm]?js$/, /\.spec\.[cm]?js$/];

function isNoise(path) {
	return (
		NOISE.some((re) => re.test(path)) ||
		TESTS.some((re) => re.test(path)) ||
		path.split(sep).includes("__tests__")
	);
}

/** Copy a tree, dropping build noise and test output. */
function copyTree(from, to, extraFilter) {
	cpSync(from, to, {
		recursive: true,
		filter: (src) => {
			if (isNoise(src)) return false;
			if (extraFilter && !extraFilter(src)) return false;
			return true;
		},
	});
}

/**
 * The manifest a copied package ships with. Dependencies are deliberately
 * dropped: the published package resolves every third-party import UPWARD
 * against the generated union, so a nested `dependencies` block would be a
 * second, drifting source of truth — and `npm install` would try to satisfy
 * its edges from the registry.
 */
function stagedManifest(manifest) {
	const staged = {
		name: manifest.name,
		version: manifest.version,
		license: manifest.license,
		description: manifest.description,
		private: true,
		type: manifest.type,
	};
	for (const key of ["main", "types", "exports", "engines"]) {
		if (manifest[key] !== undefined) staged[key] = manifest[key];
	}
	return staged;
}

// ---------------------------------------------------------------------------
// 4. The import scan
// ---------------------------------------------------------------------------

const BUILTINS = new Set([
	...builtinModules,
	...builtinModules.map((m) => `node:${m}`),
]);

const IMPORT_RE =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

/**
 * npm's own name grammar, extended with a subpath. Anything else the regex
 * catches is not an import at all — a sentence inside a doc comment, or a
 * minifier's `{from:x()}` — and must not be reported as a missing dependency.
 */
const SPECIFIER_RE =
	/^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*(?:\/[^\s"']*)?$/;

function rootPackageOf(specifier) {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	return specifier.split("/")[0];
}

function* walkFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walkFiles(full);
		else yield full;
	}
}

/**
 * Scan the copied built output for bare import specifiers and assert every one
 * is satisfiable. This is the invariant that copying alone cannot give you: it
 * catches a first-party package that grew a dependency nobody hoisted.
 */
function scanImports(stagedModules, union, copiedNames, optional) {
	const missing = new Map(); // specifier -> Set(files)
	for (const file of walkFiles(stagedModules)) {
		if (!/\.[cm]?js$/.test(file)) continue;
		// The SPA under api/public is a finished browser bundle: its imports were
		// already resolved by Vite and its minified output trips any source-level
		// regex. Node never resolves anything in there.
		if (relative(stagedModules, file).split(sep).includes("public")) continue;
		const source = readFileSync(file, "utf8");
		IMPORT_RE.lastIndex = 0;
		let match = IMPORT_RE.exec(source);
		while (match !== null) {
			const specifier = match[1];
			match = IMPORT_RE.exec(source);
			if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
			if (BUILTINS.has(specifier)) continue;
			if (!SPECIFIER_RE.test(specifier)) continue;
			const root = rootPackageOf(specifier);
			if (BUILTINS.has(root)) continue;
			if (copiedNames.has(root)) continue;
			if (union.has(root)) continue;
			if (optional.has(root)) continue;
			if (!missing.has(root)) missing.set(root, new Set());
			missing.get(root).add(relative(stagedModules, file));
		}
	}
	if (missing.size > 0) {
		const detail = [...missing.entries()]
			.map(
				([name, files]) =>
					`  - ${name}\n      ${[...files].slice(0, 3).join("\n      ")}`,
			)
			.join("\n");
		fail(
			`copied packages import third-party modules that are NOT in the ` +
				`generated dependency union. In a stranger's install these are ` +
				`ERR_MODULE_NOT_FOUND at runtime. Add them to the DECLARING ` +
				`package's \`dependencies\` (not to this script):\n${detail}`,
		);
	}
}

// ---------------------------------------------------------------------------
// 5. Tarball assertions
// ---------------------------------------------------------------------------

function tarList(tarball) {
	return execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
}

function assertTarball(tarball, copiedNames) {
	const entries = tarList(tarball);
	const has = (predicate) => entries.some(predicate);

	const manifest = JSON.parse(
		execFileSync("tar", ["-xzOf", tarball, "package/package.json"], {
			encoding: "utf8",
		}),
	);
	const bundled = new Set(manifest.bundleDependencies ?? []);
	for (const name of Object.keys(manifest.dependencies ?? {})) {
		// Re-specified from the pre-#237 assertion ("no @prismalens/* in
		// dependencies at all"): the closure is no longer bundled by the bundler,
		// it is copied and BUNDLE-declared. A first-party name that is a plain
		// dependency would send `npm install` to a registry that has never seen it.
		if (name.startsWith("@prismalens/") && !bundled.has(name)) {
			fail(`${name} is a dependency but not in bundleDependencies`);
		}
	}

	// npm strips node_modules from a tarball unless the packages are named in
	// bundleDependencies. That is the mechanism the whole design rests on, so
	// assert it rather than assuming it still holds in the current npm.
	for (const name of copiedNames) {
		const short = name.replace("@prismalens/", "");
		if (
			!has((e) => e.startsWith(`package/node_modules/@prismalens/${short}/`))
		) {
			fail(
				`the tarball has no node_modules/@prismalens/${short} — ` +
					`bundleDependencies did not survive \`npm pack\``,
			);
		}
	}

	if (
		!has((e) => e === "package/node_modules/@prismalens/api/public/index.html")
	) {
		fail(
			"the tarball has no SPA entry at node_modules/@prismalens/api/public/index.html",
		);
	}
	// Both staged layouts, asserted separately: this branch's runner reads the
	// source layout, #335's reads the dist one, and a silent loss of either is a
	// database that never gets created in a stranger's install.
	for (const layout of ["prisma", "dist/prisma"]) {
		const re = new RegExp(
			`node_modules/@prismalens/database/${layout}/.*/migration\\.sql$`,
		);
		if (!has((e) => re.test(e))) {
			fail(
				`the tarball carries no migration SQL under ${layout}/ — ` +
					"`pl up` cannot create a database",
			);
		}
	}
	if (
		!has((e) => e === "package/node_modules/@prismalens/api/dist/src/main.js")
	) {
		fail(
			"the tarball has no API entry at node_modules/@prismalens/api/dist/src/main.js",
		);
	}
	if (
		!has((e) => e === "package/node_modules/@prismalens/worker/dist/index.js")
	) {
		fail(
			"the tarball has no worker entry — the forked investigation cannot start",
		);
	}
	const noise = entries.filter((e) => /\.tsbuildinfo$|\.map$/.test(e));
	if (noise.length > 0) {
		fail(`the tarball carries build noise: ${noise.slice(0, 5).join(", ")}`);
	}

	// No unresolved workspace protocol anywhere: those strings are unresolvable
	// outside this monorepo and would break `npm install` of the tarball.
	const manifests = entries.filter((e) => e.endsWith("package.json"));
	for (const entry of manifests) {
		const body = execFileSync("tar", ["-xzOf", tarball, entry], {
			encoding: "utf8",
		});
		if (body.includes("workspace:") || body.includes("catalog:")) {
			fail(
				`${entry} still contains a \`workspace:\` or \`catalog:\` specifier`,
			);
		}
	}
	return entries;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const catalog = loadCatalog();
const workspace = loadWorkspace();
const cliPkg = workspace.get("prismalens");
if (!cliPkg) fail("the published package `prismalens` is not in the workspace");

if (!flag("--skip-build")) {
	console.log("==> building every package (turbo)");
	run("pnpm", ["build"]);
}

// Roots: everything `pl up` needs at runtime, plus the CLI's own first-party
// closure (declared as devDependencies because it used to be bundled).
const roots = [
	"@prismalens/api",
	"@prismalens/worker",
	...Object.keys(cliPkg.manifest.devDependencies ?? {}).filter((d) =>
		d.startsWith("@prismalens/"),
	),
];
const copied = collectCopyClosure(roots, workspace);
copied.delete("@prismalens/frontend"); // shipped as built static assets, not as a package
console.log(
	`==> copy closure (${copied.size}): ${[...copied].sort().join(", ")}`,
);

const union = computeUnion(copied, workspace, catalog, cliPkg.manifest);
console.log(
	`==> generated dependency union: ${union.size} third-party packages`,
);

// --- stage -----------------------------------------------------------------
rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

const cliDist = join(CLI_DIR, "dist");
if (!existsSync(join(cliDist, "bin", "prismalens.js"))) {
	fail("packages/cli/dist/bin/prismalens.js is missing — run the build first");
}
copyTree(cliDist, join(STAGING, "dist"));
for (const extra of ["NOTICE", "README.md", "LICENSE"]) {
	const from = join(CLI_DIR, extra);
	if (existsSync(from)) cpSync(from, join(STAGING, extra));
}

const stagedModules = join(STAGING, "node_modules", "@prismalens");
mkdirSync(stagedModules, { recursive: true });

for (const name of copied) {
	const { dir, manifest } = workspace.get(name);
	const target = join(stagedModules, name.replace("@prismalens/", ""));
	mkdirSync(target, { recursive: true });

	const distDir = join(dir, "dist");
	if (!existsSync(distDir)) fail(`${name} has no dist/ — it was never built`);
	// The API's tsc tree also emits `dist/scripts` and `dist/vitest.config.js`;
	// only `dist/src` is the application.
	const onlySrc =
		name === "@prismalens/api"
			? (src) => {
					const rel = relative(distDir, src);
					return rel === "" || rel === "src" || rel.startsWith(`src${sep}`);
				}
			: undefined;
	copyTree(distDir, join(target, "dist"), onlySrc);

	writeFileSync(
		join(target, "package.json"),
		`${JSON.stringify(stagedManifest(manifest), null, "\t")}\n`,
	);

	if (name === "@prismalens/database") {
		// Migration SQL + schema, applied at first boot through the
		// better-sqlite3 adapter. The `prisma` CLI is NOT in the published
		// closure and must never be invoked at user runtime.
		//
		// Staged at BOTH `prisma/<flavour>/schema` (the source layout, which is
		// what this branch's `migrate.ts` resolves) and `dist/prisma/<flavour>/
		// schema` (what #335's migration runner expects its own
		// `scripts/copy-migrations.mjs` to have staged). A bundler inlines a
		// runner's JS but will never copy its SQL, so whichever runner survives
		// the merge, the SQL is already in the tarball at the path it looks in.
		// Copying it twice costs ~30 KB and removes a guaranteed post-merge break.
		for (const flavour of ["sqlite", "pg"]) {
			const from = join(dir, "prisma", flavour, "schema");
			if (!existsSync(from)) continue;
			copyTree(from, join(target, "prisma", flavour, "schema"));
			copyTree(from, join(target, "dist", "prisma", flavour, "schema"));
		}
		// Prisma 7's `prisma-client` generator emits TypeScript, which tsc
		// compiles into dist/prisma/generated. Any NON-TypeScript asset it
		// emits (a real `.wasm`, a `.node`, a `.json`) would be invisible to
		// tsc and silently absent from the copy — assert each one made it.
		const generated = join(dir, "prisma", "generated");
		const stagedGenerated = join(target, "dist", "prisma", "generated");
		if (!existsSync(join(stagedGenerated, "client.js"))) {
			fail("the Prisma generated client did not survive the copy");
		}
		if (existsSync(generated)) {
			for (const file of walkFiles(generated)) {
				if (/\.[cm]?tsx?$/.test(file)) continue;
				const rel = relative(generated, file);
				const dest = join(stagedGenerated, rel);
				if (!existsSync(dest)) {
					mkdirSync(dirname(dest), { recursive: true });
					cpSync(file, dest);
					console.log(`    carried Prisma runtime asset: ${rel}`);
				}
			}
		}
	}

	if (name === "@prismalens/api") {
		const main = manifest.main;
		if (!main)
			fail("@prismalens/api declares no `main` — `pl up` cannot boot it");
		if (!existsSync(join(target, main))) {
			fail(
				`@prismalens/api declares main "${main}" but the copied output has no ` +
					`such file. nest build's output root moved; fix the manifest.`,
			);
		}
		// The SPA is served single-origin by the API process. Plain filesystem
		// copy — no bundler is involved in a directory of static assets.
		const spa = join(ROOT, "packages", "frontend", "dist", "client");
		if (!existsSync(join(spa, "index.html"))) {
			fail(
				`packages/frontend/dist/client/index.html is missing. TanStack Start ` +
					`only emits an index.html when the Vite config sets ` +
					`\`spa: { enabled: true }\`; without it you get SSR output and no ` +
					`SPA entry.`,
			);
		}
		copyTree(spa, join(target, "public"));
	}
}

/**
 * Deliberately-optional imports: a package that declares an OPTIONAL peer (or
 * an optionalDependency) is saying "resolve me lazily, refuse gracefully when
 * I'm absent". Read from the declaring manifests, so this is not a list this
 * script maintains.
 */
const optional = new Set();
for (const name of copied) {
	const { manifest } = workspace.get(name);
	for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
		optional.add(dep);
	}
	for (const [dep, meta] of Object.entries(
		manifest.peerDependenciesMeta ?? {},
	)) {
		if (meta?.optional) optional.add(dep);
	}
}

scanImports(stagedModules, union, new Set(copied), optional);
console.log(
	`==> import scan: every bare specifier resolves` +
		(optional.size > 0
			? ` (optional: ${[...optional].sort().join(", ")})`
			: ""),
);

// --- generated manifest -----------------------------------------------------
const dependencies = {};
for (const name of [...union.keys()].sort()) {
	dependencies[name] = union.get(name).range;
}

// The first-party packages must appear in BOTH `dependencies` and
// `bundleDependencies`. Verified against npm 11: a name listed only in
// `bundleDependencies` is treated as extraneous and its files are silently
// dropped from the tarball — the pack "succeeds" and the artifact has no
// application in it. `assertTarball` below is what keeps that honest.
for (const name of [...copied].sort()) {
	dependencies[name] = workspace.get(name).manifest.version;
}

const publishManifest = {
	...cliPkg.manifest,
	dependencies,
	bundleDependencies: [...copied].sort(),
	files: ["dist", "NOTICE", "node_modules/@prismalens"],
	engines: {
		// `packages/cli` alone declares node >=22, but `@prismalens/api` and
		// `@prismalens/database` both declare >=24 and are now IN this tarball.
		// One published package gets one floor, and a package that installs on
		// Node 22 then crashes on `pl up` is worse than a higher floor.
		...cliPkg.manifest.engines,
		node: ENGINES_NODE,
	},
};
publishManifest.devDependencies = undefined;
publishManifest.scripts = undefined;

writeFileSync(
	join(STAGING, "package.json"),
	`${JSON.stringify(publishManifest, null, "\t")}\n`,
);

// --- pack -------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
for (const stale of readdirSync(OUT_DIR)) {
	if (stale.endsWith(".tgz")) rmSync(join(OUT_DIR, stale));
}
console.log("==> npm pack");
run(
	"npm",
	["pack", "--pack-destination", OUT_DIR, "--loglevel", "warn"],
	STAGING,
);

const packed = readdirSync(OUT_DIR).find((f) => f.endsWith(".tgz"));
if (!packed) {
	fail(`npm pack produced no tarball in ${OUT_DIR}`);
}
const tarball = join(OUT_DIR, packed);
const entries = assertTarball(tarball, copied);
const bytes = statSync(tarball).size;

console.log(
	`\n==> ${relative(ROOT, tarball)}  ` +
		`${(bytes / 1024 / 1024).toFixed(2)} MB, ${entries.length} entries`,
);
console.log("    bundleDependencies survived; no workspace:/catalog: strings");
writeFileSync(join(OUT_DIR, "tarball.txt"), `${tarball}\n`);

if (flag("--publish") || flag("--publish-dry-run")) {
	// Publish the exact bytes the smoke gate verified. `pnpm publish -r` would
	// re-pack from the workspace and is NOT guaranteed to reproduce this
	// tarball's bundleDependencies handling.
	const args = ["publish", tarball, "--access", "public"];
	if (flag("--publish-dry-run")) args.push("--dry-run");
	console.log(`==> npm ${args.join(" ")}`);
	run("npm", args);
}
