// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Writes a condition simulator's stamps through the registry's own writer (#1101): one per
// walk the condition applies to, carrying the entry's profile unchanged. `observed` holds
// numbers only, so the full detail rides as an artifact the stamp hashes.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeStamp as writeRegistryStamp } from "../../../packages/@prismalens/registry/src/stamp.ts";

export const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

/** The commit under test: `PRISMALENS_STAMP_COMMIT`, else this checkout's HEAD. */
export function commitSha() {
	return (
		process.env.PRISMALENS_STAMP_COMMIT ??
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		}).trim()
	);
}

export const runId = () => process.env.PRISMALENS_RUN_ID ?? "local";

/** Where one run's stamps go: `PRISMALENS_STAMP_DIR`, else `.stamps/<run>/`. */
export function stampDir() {
	return resolve(
		process.env.PRISMALENS_STAMP_DIR ?? join(REPO_ROOT, ".stamps", runId()),
	);
}

/**
 * The condition's registry entry, as `pnpm registry profile <id> --json` resolves it.
 * @param {string} condition
 * @returns {{ id: string, status: string, simulator: { id: string }, profile: Record<string, unknown>, walks: string[] }}
 */
export function conditionEntry(condition) {
	const out = execFileSync(
		process.execPath,
		[
			"packages/@prismalens/registry/src/cli.ts",
			"--config",
			"packages/frontend/registry.config.json",
			"profile",
			condition,
			"--json",
		],
		{ cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	const entry = JSON.parse(out).find(
		(/** @type {{ id: string }} */ e) => e.id === condition,
	);
	if (!entry) throw new Error(`No condition ${condition} in the registry.`);
	return entry;
}

/** Numbers stay numbers, booleans become 1 or 0; the rest is left to the detail artifact. */
function numeric(/** @type {Record<string, unknown>} */ observed) {
	return Object.fromEntries(
		Object.entries(observed).flatMap(([k, v]) =>
			typeof v === "number" && Number.isFinite(v)
				? [[k, v]]
				: typeof v === "boolean"
					? [[k, v ? 1 : 0]]
					: [],
		),
	);
}

/**
 * Writes `<walk>__<condition>.json` for `--walk`/`PRISMALENS_WALK`, else for every walk the
 * entry applies to, and returns their paths. `files` are artifacts already in the stamp dir.
 * @param {{ condition: string, simulator: string, observed: Record<string, unknown>, detail?: unknown, files?: string[] }} input
 */
export function writeStamp(input) {
	const entry = conditionEntry(input.condition);
	if (entry.simulator.id !== input.simulator)
		throw new Error(
			`${input.condition} names simulator ${entry.simulator.id}, not ${input.simulator}; point its entry at ${input.simulator}.`,
		);
	const dir = stampDir();
	mkdirSync(dir, { recursive: true });
	const detail = `${input.condition}.detail.json`;
	writeFileSync(
		join(dir, detail),
		`${JSON.stringify(input.detail ?? input.observed, null, "\t")}\n`,
	);
	const pick = process.argv.indexOf("--walk");
	const only =
		(pick > -1 ? process.argv[pick + 1] : undefined) ??
		process.env.PRISMALENS_WALK;
	const walks = only ? [only] : entry.walks;
	if (!walks.length)
		throw new Error(`${input.condition} applies to no walk; pass --walk <id>.`);
	return walks.map((walk) => {
		const file = writeRegistryStamp(
			dir,
			{
				condition: input.condition,
				walk,
				simulator: input.simulator,
				profile: /** @type {any} */ (entry.profile),
				observed: numeric(input.observed),
				sha: commitSha(),
				run: runId(),
			},
			[detail, ...(input.files ?? [])],
		);
		console.log(`Stamp: ${file}`);
		return file;
	});
}
