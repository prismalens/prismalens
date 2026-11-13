// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The stamp a condition simulator writes once it has induced its condition (#1101): the
// scorer trusts a category's score only when every cell it maps to has one. Only a
// simulator writes it, never a judge. Local shape until the registry's stamp schema lands.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

/**
 * @typedef {object} Stamp
 * @property {1} version
 * @property {string} condition       the condition id, e.g. "net.slow-link"
 * @property {string} simulator       the simulator id, e.g. "net.throttle"
 * @property {Record<string, unknown>} profile   what the simulator was asked to induce
 * @property {Record<string, unknown>} observed  what it measured once induced
 * @property {string} commit          the SHA the stack under test was built from
 * @property {string} runId           one scoring run; a rerun with the same id replaces the stamp
 * @property {Record<string, string>} artifacts  file path → sha256 of what the run produced
 * @property {string} at              ISO time the stamp was written
 */

/** The commit under test: `PRISMALENS_STAMP_COMMIT`, else this checkout's HEAD. */
export function commitSha() {
	if (process.env.PRISMALENS_STAMP_COMMIT)
		return process.env.PRISMALENS_STAMP_COMMIT;
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

/** Where stamps go: `PRISMALENS_STAMP_DIR`, else `.stamps/` at the repo root. */
export function stampDir() {
	return resolve(
		process.env.PRISMALENS_STAMP_DIR ?? join(REPO_ROOT, ".stamps"),
	);
}

/** @param {string} file */
export function sha256File(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Writes `<stampDir>/<runId>/<condition>.json` and returns its path.
 * @param {{ condition: string, simulator: string, profile: Record<string, unknown>, observed: Record<string, unknown>, artifacts?: string[] }} input
 */
export function writeStamp(input) {
	const runId = process.env.PRISMALENS_RUN_ID ?? "local";
	/** @type {Stamp} */
	const stamp = {
		version: 1,
		condition: input.condition,
		simulator: input.simulator,
		profile: input.profile,
		observed: input.observed,
		commit: commitSha(),
		runId,
		artifacts: Object.fromEntries(
			(input.artifacts ?? []).map((f) => [
				relative(REPO_ROOT, f).replaceAll("\\", "/"),
				sha256File(f),
			]),
		),
		at: new Date().toISOString(),
	};
	const file = join(stampDir(), runId, `${input.condition}.json`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(stamp, null, "\t")}\n`);
	console.log(`Stamp: ${file}`);
	return file;
}
