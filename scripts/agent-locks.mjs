#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pinned agents install from a committed lock, the same bytes on every runner (#1085, #1154).
 * Each agent's `pin.json` (`agent-pins.mjs`) has a folder under `scripts/agent-locks/`: an npm pin a
 * `package.json` and `package-lock.json`, a Python pin a `requirements.in` and a hashed
 * `requirements.lock`. Latest legs are not locked; they mirror what users install today.
 *
 *   agent-locks.mjs regen [<pin>...]   write the locks from the pins (needs network)
 *   agent-locks.mjs check [--root <dir>]
 *     fail naming each lock that is missing or not at its pin; --root names another checkout
 *   agent-locks.mjs install <pin> [--into <dir>]
 *     install the pin from its lock; prints the folder holding its binaries on stdout
 *
 * A pin bump runs `regen` before it merges; `check` is what stops it otherwise.
 */
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	DEFAULT_RELEASE_AGE_DAYS,
	pythonConstraints,
	pythonPins,
	readPins,
} from "./agent-pins.mjs";

const WINDOWS = process.platform === "win32";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCKS = join(ROOT, "scripts/agent-locks");
const PYTHON = "3.14";
/** Days a release soaks before its pin moves; an npm lock resolves its dependencies as of then. */
export const PIN_SOAK_DAYS = DEFAULT_RELEASE_AGE_DAYS;

/** Python pins and the packages installed beside the CLI, from each pypi agent's pin.json. */
export const PYTHON_PINS = pythonPins();

/** What a Python pin needs that its channel does not cap; each pin.json says why. */
export const PYTHON_PIN_CONSTRAINTS = pythonConstraints();

export { readPins };

/** `@anthropic-ai/claude-code` is `claude-code`. */
export const lockName = (pin) => pin.replace(/^@[^/]+\//, "");

export const resolvedAsOf = (publishedAt, days = PIN_SOAK_DAYS) =>
	new Date(Date.parse(publishedAt) + days * 86_400_000).toISOString();

const run = (file, args, options = {}) =>
	execFileSync(file, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		shell: WINDOWS && file === "npm",
		...options,
	});

/** Runs a command whose own output belongs on stderr, so stdout stays the caller's answer. */
const runLoud = (file, args, options = {}) =>
	execFileSync(file, args, {
		stdio: ["ignore", 2, 2],
		shell: WINDOWS && file === "npm",
		...options,
	});

function npmPublishedAt(pkg, version) {
	const at = JSON.parse(run("npm", ["view", pkg, "time", "--json"]))[version];
	if (!at) throw new Error(`npm lists no ${pkg}@${version}`);
	return at;
}

/**
 * What a lock folder says about its pin: the problems that make it stale, none when it holds.
 * `files` maps a file name to its text, or is missing a name when the file is absent.
 */
export function lockProblems(pin, version, files) {
	if (PYTHON_PINS[pin]) {
		const text = files["requirements.lock"];
		if (text === undefined) return ["requirements.lock is missing"];
		const escaped = pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const locked = new RegExp(`^${escaped}==(\\S+)`, "m").exec(text)?.[1];
		return locked === version
			? []
			: [
					`requirements.lock has ${pin}==${locked ?? "nothing"}, the pin is ${version}`,
				];
	}
	const problems = [];
	const manifest = files["package.json"];
	const lock = files["package-lock.json"];
	if (manifest === undefined) problems.push("package.json is missing");
	else {
		const wanted = JSON.parse(manifest).dependencies?.[pin];
		if (wanted !== version)
			problems.push(
				`package.json wants ${pin}@${wanted ?? "nothing"}, the pin is ${version}`,
			);
	}
	if (lock === undefined) problems.push("package-lock.json is missing");
	else {
		const packages = JSON.parse(lock).packages ?? {};
		const root = packages[""]?.dependencies?.[pin];
		const locked = packages[`node_modules/${pin}`]?.version;
		if (root !== version)
			problems.push(
				`package-lock.json asks for ${pin}@${root ?? "nothing"}, the pin is ${version}`,
			);
		if (locked !== version)
			problems.push(
				`package-lock.json resolves ${pin} to ${locked ?? "nothing"}, the pin is ${version}`,
			);
	}
	return problems;
}

const FILES = ["package.json", "package-lock.json", "requirements.lock"];

function readLockFiles(dir) {
	const files = {};
	for (const name of FILES) {
		const path = join(dir, name);
		if (existsSync(path)) files[name] = readFileSync(path, "utf8");
	}
	return files;
}

/** The stale entries of one pin's lock, as `{ name, problem }`. */
function pinStale(pin, version, locksDir) {
	const name = lockName(pin);
	const dir = join(locksDir, name);
	if (!existsSync(dir)) return [{ name, problem: "no lock folder" }];
	return lockProblems(pin, version, readLockFiles(dir)).map((problem) => ({
		name,
		problem,
	}));
}

/** Every stale entry under `locksDir` for `pins`, as `{ name, problem }`; empty when all hold. */
export function checkLocks(pins, locksDir = LOCKS) {
	const stale = [];
	const known = new Set(Object.keys(pins).map(lockName));
	for (const [pin, version] of Object.entries(pins))
		stale.push(...pinStale(pin, version, locksDir));
	if (existsSync(locksDir))
		for (const entry of readdirSync(locksDir, { withFileTypes: true }))
			if (entry.isDirectory() && !known.has(entry.name))
				stale.push({
					name: entry.name,
					problem: "has no agent pin.json",
				});
	return stale;
}

async function regenOne(pin, version, locksDir) {
	const dir = join(locksDir, lockName(pin));
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	if (PYTHON_PINS[pin]) {
		const wants = [
			`${pin}==${version}`,
			...PYTHON_PINS[pin],
			...(PYTHON_PIN_CONSTRAINTS[pin] ?? []),
		];
		writeFileSync(join(dir, "requirements.in"), `${wants.join("\n")}\n`);
		runLoud(
			"uv",
			[
				"pip",
				"compile",
				"requirements.in",
				"--universal",
				"--python-version",
				PYTHON,
				"--generate-hashes",
				"--output-file",
				"requirements.lock",
				"--quiet",
			],
			{ cwd: dir },
		);
		return;
	}
	const asOf = resolvedAsOf(npmPublishedAt(pin, version));
	writeFileSync(
		join(dir, "package.json"),
		`${JSON.stringify(
			{
				name: `agent-lock-${lockName(pin)}`,
				version: "0.0.0",
				private: true,
				dependencies: { [pin]: version },
			},
			null,
			"\t",
		)}\n`,
	);
	runLoud(
		"npm",
		[
			"install",
			"--package-lock-only",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
			"--before",
			asOf,
		],
		{ cwd: dir },
	);
}

/**
 * Installs `pin` from its lock into `into` and returns the folder holding its binaries.
 * npm: `npm ci` of the locked tree; uv: a venv synced to the hashed lock. A lock that is not
 * at the pin throws, so a stale lock never installs the old version in the pin's name.
 */
export function installLocked(pin, into, locksDir = LOCKS, pins = readPins()) {
	const src = join(locksDir, lockName(pin));
	const stale = pinStale(pin, pins[pin], locksDir);
	if (stale.length)
		throw new Error(
			stale.map((s) => `agent-locks/${s.name}: ${s.problem}`).join("; "),
		);
	mkdirSync(into, { recursive: true });
	if (PYTHON_PINS[pin]) {
		const venv = join(into, "venv");
		const bin = join(venv, WINDOWS ? "Scripts" : "bin");
		runLoud("uv", ["venv", "--quiet", "--python", PYTHON, venv]);
		runLoud("uv", [
			"pip",
			"sync",
			"--quiet",
			"--python",
			join(bin, WINDOWS ? "python.exe" : "python"),
			join(src, "requirements.lock"),
		]);
		return bin;
	}
	for (const name of ["package.json", "package-lock.json"])
		copyFileSync(join(src, name), join(into, name));
	// npm runs through a shell on Windows, so the path goes in as cwd, never as an argument.
	runLoud("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], {
		cwd: into,
	});
	return join(into, "node_modules", ".bin");
}

async function main() {
	const [command, ...rest] = process.argv.slice(2);
	const pins = readPins();
	if (command === "check") {
		const { values } = parseArgs({
			args: rest,
			options: { root: { type: "string" } },
		});
		const root = values.root ?? ROOT;
		const checked = values.root ? readPins(root) : pins;
		const stale = checkLocks(checked, join(root, "scripts/agent-locks"));
		if (!stale.length) {
			console.log(
				`agent-locks: ${Object.keys(checked).length} locks at their pins`,
			);
			return;
		}
		for (const { name, problem } of stale)
			console.error(`agent-locks/${name}: ${problem}`);
		console.error(
			"Run `node scripts/agent-locks.mjs regen` and commit scripts/agent-locks.",
		);
		process.exit(1);
	}
	if (command === "regen") {
		const { positionals } = parseArgs({ args: rest, allowPositionals: true });
		const which = positionals.length ? positionals : Object.keys(pins);
		for (const pin of which) {
			if (!pins[pin]) throw new Error(`no pin ${pin} in any agent pin.json`);
			console.error(`regen ${pin}@${pins[pin]}`);
			await regenOne(pin, pins[pin], LOCKS);
		}
		return;
	}
	if (command === "install") {
		const { values, positionals } = parseArgs({
			args: rest,
			allowPositionals: true,
			options: { into: { type: "string" } },
		});
		const [pin] = positionals;
		if (!pin || !pins[pin]) {
			console.error("usage: agent-locks.mjs install <pin> [--into <dir>]");
			process.exit(2);
		}
		const into =
			values.into ?? mkdtempSync(join(tmpdir(), `pl-lock-${lockName(pin)}-`));
		console.log(installLocked(pin, into));
		return;
	}
	console.error(
		"usage: agent-locks.mjs regen [<pin>...] | check | install <pin>",
	);
	process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
