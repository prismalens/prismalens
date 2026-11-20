// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The production build a built sim serves, through turbo's cache (which git worktrees of one
// clone share, or TURBO_CACHE_DIR), and skipped when turbo's own task hashes match the last build
// here (#1133).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TURBO = join(ROOT, "node_modules/turbo/bin/turbo");
const MARKER = join(ROOT, ".turbo", "sim-build.json");
const INDEX = join(ROOT, "packages/frontend/dist/client/index.html");
const API_MAIN = join(ROOT, "packages/api/dist/src/main.js");
const FILTERS = ["--filter=@prismalens/frontend", "--filter=@prismalens/api"];

/** Runs turbo from the repo root; when `quiet`, its output shows only if it fails. */
function turbo(/** @type {string[]} */ args, quiet = false) {
	const out = execFileSync(process.execPath, [TURBO, ...args], {
		cwd: ROOT,
		windowsHide: true,
		encoding: "utf8",
		stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
		maxBuffer: 256 * 1024 * 1024,
	});
	return out ?? "";
}

/** One key over turbo's hashes for the API build and the gallery build, inputs and deps included. */
function buildKey() {
	const plan = JSON.parse(
		turbo(["run", "build", "build:gallery", ...FILTERS, "--dry=json"], true),
	);
	/** @type {{ taskId: string, hash: string }[]} */
	const tasks = plan.tasks;
	const ids = tasks
		// The plain frontend build shares dist with the gallery build and is never run here.
		.filter((t) => t.taskId !== "@prismalens/frontend#build")
		.map((t) => `${t.taskId}=${t.hash}`)
		.sort();
	return createHash("sha256").update(ids.join("\n")).digest("hex");
}

const sha = (/** @type {string} */ file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * Whether to reuse this checkout's build, and why: `key` is this run's hash, `last` what the last
 * build recorded, `index` and `api` the hashes of the built index.html and API entry now (null when
 * missing). Either output can be replaced while the sources hash the same, so both are compared.
 * @param {{ force: boolean, key: string, last: { key?: string, index?: string, api?: string }, index: string | null, api: string | null }} s
 * @returns {{ reuse: true, line: string } | { reuse: false, line: string }}
 */
export function buildDecision({ force, key, last, index, api }) {
	if (force) return { reuse: false, line: "rebuilding (--rebuild)" };
	if (!last.key)
		return {
			reuse: false,
			line: "rebuilding (no build recorded in this checkout)",
		};
	if (last.key !== key)
		return {
			reuse: false,
			line: "rebuilding (sources changed since the last build)",
		};
	if (!index || last.index !== index)
		return {
			reuse: false,
			line: "rebuilding (the build output was replaced or removed)",
		};
	if (!api || last.api !== api)
		return {
			reuse: false,
			line: "rebuilding (the API output was replaced or removed)",
		};
	return {
		reuse: true,
		line: `reused the build: sources unchanged since the last build here (${key.slice(0, 12)})`,
	};
}

/**
 * Builds the API, the frontend's workspace packages and the frontend with the design gallery,
 * unless the sources are unchanged since this checkout's last build and its output is intact.
 * `force` rebuilds and bypasses the turbo cache.
 */
export function buildForSim({
	force = false,
	quiet = false,
	log = (/** @type {string} */ m) => console.log(m),
} = {}) {
	const key = buildKey();
	/** @type {{ key?: string, index?: string, api?: string }} */
	let last = {};
	try {
		last = JSON.parse(readFileSync(MARKER, "utf8"));
	} catch {}
	const index = existsSync(INDEX) ? sha(INDEX) : null;
	const api = existsSync(API_MAIN) ? sha(API_MAIN) : null;
	const decision = buildDecision({ force, key, last, index, api });
	if (decision.reuse) {
		log(decision.line);
		return "reused";
	}
	log(decision.line);
	const extra = force ? ["--force"] : [];
	turbo(
		[
			"run",
			"build",
			"--filter=@prismalens/frontend^...",
			"--filter=@prismalens/api",
			"--output-logs=errors-only",
			...extra,
		],
		quiet,
	);
	turbo(
		[
			"run",
			"build:gallery",
			"--filter=@prismalens/frontend",
			"--output-logs=errors-only",
			...extra,
		],
		quiet,
	);
	mkdirSync(dirname(MARKER), { recursive: true });
	writeFileSync(
		MARKER,
		JSON.stringify({ key, index: sha(INDEX), api: sha(API_MAIN) }, null, "\t"),
	);
	return "rebuilt";
}
