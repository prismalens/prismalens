#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Upgrade chain (#920): does every release already on npm upgrade, through its own
 * `pl upgrade`, to the build under test, with the workspace's data intact?
 *
 * The releases come from `npm view prismalens versions` (stable, 0.5.0 and later), never
 * from a list in this repo. A local registry proxies npmjs and carries the candidate tarball,
 * so an older `pl upgrade --version <candidate>` installs a build npm does not have yet.
 * The chain installs the oldest release, boots it on a fresh workspace and writes an incident,
 * then upgrades release by release up to the candidate, booting after each hop to check the
 * incident survived. A second install of the oldest release upgrades straight to the candidate.
 *
 * Usage: packed-upgrade-chain.mjs <dir-with-tarball>
 *   PRISMALENS_TARBALL overrides with an exact path. Env: PACKED_CHAIN_PORT (default 3107).
 *   An old `pl` with no `upgrade` command is moved by `npm install -g`, and the hop says so.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stripVTControlCharacters } from "node:util";
import crossSpawn from "cross-spawn";
import { baseEnv, homeDirs, killTree } from "./lib/gate-portable.mjs";
import { startLocalRegistry } from "./lib/local-registry.mjs";
import { candidateVersion, hops, releasesFrom } from "./lib/upgrade-chain.mjs";

const WIN = process.platform === "win32";
const BASE_PORT = Number(process.env.PACKED_CHAIN_PORT ?? "3107");
const work = mkdtempSync(join(tmpdir(), "pl-chain-"));

let failed = 0;
const ok = (m) => console.log(`[upgrade-chain] OK   ${m}`);
const bad = (m) => {
	failed++;
	console.error(`[upgrade-chain] FAIL ${m}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
);

function npm(args, { env = cleanEnv, cwd, capture = false } = {}) {
	const r = crossSpawn.sync("npm", args, {
		env,
		cwd,
		encoding: "utf8",
		stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
	});
	if (r.error) throw r.error;
	if (r.status !== 0)
		throw new Error(`npm ${args.join(" ")} exited ${r.status}`);
	return r.stdout ?? "";
}

function findTarball() {
	if (process.env.PRISMALENS_TARBALL)
		return resolve(process.env.PRISMALENS_TARBALL);
	const dir = process.argv[2];
	if (!dir)
		throw new Error(
			"usage: packed-upgrade-chain.mjs <dir-with-tarball> (or set PRISMALENS_TARBALL)",
		);
	const found = readdirSync(resolve(dir)).find((f) =>
		/^prismalens-[0-9].*\.tgz$/.test(f),
	);
	if (!found) throw new Error(`no tarball matching prismalens-*.tgz in ${dir}`);
	return join(resolve(dir), found);
}

/** Relative names, so a Windows drive letter never reads as a tar host. */
const tar = (tgz, args) =>
	execFileSync("tar", args, { cwd: dirname(tgz), encoding: "utf8" });

/** The tarball, re-versioned when its own version is one npm already has. */
function candidateTarball(tgz, own, version) {
	if (version === own) return tgz;
	const dir = join(work, "candidate");
	mkdirSync(dir, { recursive: true });
	tar(tgz, ["-xzf", basename(tgz), "-C", dir]);
	const manifest = join(dir, "package", "package.json");
	const pkg = JSON.parse(readFileSync(manifest, "utf8"));
	pkg.version = version;
	writeFileSync(manifest, JSON.stringify(pkg, null, 2));
	const out = npm(["pack", "--pack-destination", dir], {
		cwd: join(dir, "package"),
		capture: true,
	});
	return join(dir, out.trim().split("\n").at(-1).trim());
}

/** The CLI of an install under `prefix`, as `node <bin>`; no shim between us and it. */
function cliOf(prefix) {
	const pkgDir = WIN
		? join(prefix, "node_modules", "prismalens")
		: join(prefix, "lib", "node_modules", "prismalens");
	const manifest = JSON.parse(
		readFileSync(join(pkgDir, "package.json"), "utf8"),
	);
	const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.pl;
	return [process.execPath, join(pkgDir, bin)];
}

const exec = (cli, args, env) =>
	new Promise((r) =>
		execFile(
			cli[0],
			[...cli.slice(1), ...args],
			{ env, timeout: 300_000 },
			(error, stdout, stderr) =>
				r({
					code: error ? (error.code ?? 1) : 0,
					out: stripVTControlCharacters(`${stdout}${stderr}`),
				}),
		),
	);

/** One lineage: an npm prefix and a workspace, upgraded in place the way a person's install is. */
function lineage(name, registry, port) {
	const dir = join(work, name);
	const home = join(dir, "home");
	const prefix = join(dir, "prefix");
	const workspace = join(dir, "workspace");
	const env = {
		...process.env,
		...baseEnv({ home, tmp: join(dir, "tmp") }),
		NPM_CONFIG_USERCONFIG: registry.npmrc,
		NPM_CONFIG_REGISTRY: registry.registry,
		NPM_CONFIG_PREFIX: prefix,
		PRISMALENS_TELEMETRY: "off",
		PRISMALENS_UPDATE_CHECK: "off",
		PRISMALENS_HOST: "127.0.0.1",
		CI: "true",
	};
	for (const d of [...homeDirs(env), workspace])
		mkdirSync(d, { recursive: true });
	return {
		name,
		prefix,
		workspace,
		env,
		port,
		base: `http://127.0.0.1:${port}`,
	};
}

/** Boots `pl up` on the workspace until it answers /health, then stops it, which is all an upgrade needs from a boot. */
async function bootAndStop(line) {
	const cli = cliOf(line.prefix);
	let log = "";
	const child = spawn(
		cli[0],
		[
			...cli.slice(1),
			"up",
			"--port",
			String(line.port),
			"--workspace",
			line.workspace,
			"--no-open",
		],
		{
			env: line.env,
			detached: !WIN,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	for (const s of [child.stdout, child.stderr]) s.on("data", (d) => (log += d));
	const exited = new Promise((r) => child.on("exit", r));
	try {
		let healthy = false;
		for (let i = 0; i < 360 && !healthy && child.exitCode === null; i++) {
			healthy = await fetch(`${line.base}/health`, {
				signal: AbortSignal.timeout(2000),
			})
				.then((r) => r.ok)
				.catch(() => false);
			if (!healthy) await sleep(500);
		}
		if (!healthy)
			throw new Error(
				`pl up never became healthy: ${stripVTControlCharacters(log).slice(-1200)}`,
			);
	} finally {
		killTree(child.pid, "SIGTERM");
		child.kill();
		await Promise.race([exited, sleep(30_000)]);
		killTree(child.pid, "SIGKILL");
	}
}

/** The workspace's database, opened with node:sqlite so no version's native module is involved. */
const withDatabase = (line, fn) => {
	const db = new DatabaseSync(join(line.workspace, "prismalens.db"));
	try {
		return fn(db);
	} finally {
		db.close();
	}
};

/** A value for a NOT NULL column the insert does not name, by its declared type. */
const filler = (col) =>
	/INT|REAL|NUM|BOOL|DOUBLE|FLOAT/i.test(col.type)
		? 0
		: /DATE|TIME/i.test(col.type)
			? Date.now()
			: "x";

/** Boots the release once so it migrates its database, then writes the incident later boots must still hold. */
async function seed(line, version) {
	await bootAndStop(line);
	withDatabase(line, (db) => {
		const cols = db.prepare('PRAGMA table_info("incidents")').all();
		const set = {
			id: randomUUID(),
			title: `written by ${version}`,
			status: "investigating",
			number: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		const row = Object.fromEntries(
			cols
				.filter(
					(c) => c.name in set || (c.notnull && c.dflt_value === null && !c.pk),
				)
				.map((c) => [c.name, c.name in set ? set[c.name] : filler(c)]),
		);
		const names = Object.keys(row);
		db.prepare(
			`INSERT INTO "incidents" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
		).run(...Object.values(row));
	});
}

/** Boots the upgraded release, which migrates, and checks every incident written so far is still there. */
async function survives(line, written) {
	await bootAndStop(line);
	const titles = withDatabase(line, (db) =>
		db
			.prepare('SELECT "title" FROM "incidents"')
			.all()
			.map((r) => r.title),
	);
	for (const title of written.map((v) => `written by ${v}`))
		if (!titles.includes(title))
			throw new Error(
				`"${title}" is gone after the upgrade; the database holds ${JSON.stringify(titles)}`,
			);
}

/** `pl upgrade --version`, from the installed (old) pl; npm itself when that pl has no `upgrade`. */
async function upgrade(line, from, to) {
	const cli = cliOf(line.prefix);
	const attempt = await exec(cli, ["upgrade", "--version", to], line.env);
	if (attempt.code === 0) return "pl upgrade";
	if (/unknown command|not a known|Unknown command/i.test(attempt.out)) {
		npm(
			[
				"install",
				"-g",
				`prismalens@${to}`,
				"--no-audit",
				"--no-fund",
				"--loglevel=error",
			],
			{ env: line.env },
		);
		return `npm install -g (${from} has no pl upgrade)`;
	}
	throw new Error(
		`pl upgrade --version ${to} exited ${attempt.code}: ${attempt.out.slice(-800)}`,
	);
}

async function versionOf(line) {
	return (await exec(cliOf(line.prefix), ["--version"], line.env)).out.trim();
}

async function walk(line, plan, written, label) {
	for (const hop of plan) {
		try {
			const how = await upgrade(line, hop.from, hop.to);
			const now = await versionOf(line);
			if (now !== hop.to)
				throw new Error(
					`pl --version printed ${now} after the upgrade to ${hop.to}`,
				);
			await survives(line, written);
			ok(
				`${label}: ${hop.from} -> ${hop.to} through ${how}; booted, ${written.length} earlier incident(s) kept`,
			);
		} catch (e) {
			bad(`${label}: ${hop.from} -> ${hop.to}: ${e?.message ?? e}`);
			return false;
		}
	}
	return true;
}

async function main() {
	const tgz = findTarball();
	const own = JSON.parse(
		tar(tgz, ["-xzOf", basename(tgz), "package/package.json"]),
	).version;
	const published = JSON.parse(
		npm(["view", "prismalens", "versions", "--json"], { capture: true }),
	);
	const releases = releasesFrom(published);
	const candidate = candidateVersion(own, published);
	console.log(
		`[upgrade-chain] tarball ${own}${candidate === own ? "" : `, published locally as ${candidate}`}; releases from npm: ${releases.join(", ") || "none"}`,
	);
	if (releases.length === 0)
		throw new Error("npm lists no release to upgrade from");
	const plan = hops(releases, candidate);

	const registry = await startLocalRegistry({
		dir: work,
		env: cleanEnv,
		proxy: true,
	});
	try {
		npm(["publish", candidateTarball(tgz, own, candidate), "--tag", "latest"], {
			env: {
				...cleanEnv,
				NPM_CONFIG_USERCONFIG: registry.npmrc,
				NPM_CONFIG_REGISTRY: registry.registry,
			},
		});
		const [oldest] = releases;

		const chain = lineage("chain", registry, BASE_PORT);
		npm(
			[
				"install",
				"-g",
				`prismalens@${oldest}`,
				"--no-audit",
				"--no-fund",
				"--loglevel=error",
			],
			{ env: chain.env },
		);
		await seed(chain, oldest);
		ok(
			`chain: ${oldest} installed from npm, booted and migrated, incident written`,
		);
		const written = [oldest];
		const steps = plan.filter((h) => h.kind === "step");
		// Each hop is one release further, so the incident written first must outlive them all.
		await walk(chain, steps, written, "chain");

		const skip = plan.find((h) => h.kind === "skip");
		if (skip) {
			const direct = lineage("skip", registry, BASE_PORT + 1);
			npm(
				[
					"install",
					"-g",
					`prismalens@${skip.from}`,
					"--no-audit",
					"--no-fund",
					"--loglevel=error",
				],
				{ env: direct.env },
			);
			await seed(direct, skip.from);
			await walk(direct, [skip], [skip.from], "skip");
		}
	} finally {
		registry.stop();
	}
}

main()
	.catch((e) => bad(e?.stack ?? String(e)))
	.finally(() => {
		if (failed === 0) {
			try {
				rmSync(work, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 300,
				});
			} catch {
				// Windows may hold a killed process's files
			}
		} else console.error(`[upgrade-chain] kept ${work} for the logs`);
		console.log(
			failed === 0
				? "[upgrade-chain] CHAIN OK"
				: `[upgrade-chain] ${failed} failed`,
		);
		process.exit(failed === 0 ? 0 : 1);
	});
