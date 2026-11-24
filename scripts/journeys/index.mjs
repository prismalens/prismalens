// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The core journeys, each written once and run by every target: a vitest spec in-process
// (packages/api/test/journeys) and `scripts/packed-intake.mjs` on the packed tarball, scripted or live.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alertToReport } from "./alert-to-report.mjs";
import { eventsOf } from "./lib.mjs";
import { restartResumes } from "./restart-resumes.mjs";

/** @import { Journey, Target } from "./types.mjs" */

/** @type {Journey[]} */
export const journeys = [alertToReport, restartResumes];

/**
 * Runs each journey in turn on one target and stops at the first failure.
 * @param {Target} target
 * @param {Journey[]} list
 * @param {(message: string) => void} [log]
 * @param {Map<string, string[]>} [started] filled with the runs each journey started, so a failure still names them
 */
export async function runJourneys(
	target,
	list,
	log = console.log,
	started = new Map(),
) {
	for (const journey of list) {
		/** @type {string[]} */
		const investigations = [];
		started.set(journey.name, investigations);
		log(`[journey] ${journey.name} on ${target.name} (${target.agent} agent)`);
		try {
			await journey.run(target, {
				log: (message) => log(`[${journey.name}] ${message}`),
				investigations,
			});
		} catch (error) {
			await explainStall(target, investigations, log);
			throw new Error(`journey ${journey.name} failed on ${target.name}`, {
				cause: error,
			});
		}
		log(`[journey] ${journey.name} OK`);
	}
}

/** What a run that never finished was doing, so the next failure names its cause (#876, #1085). */
async function explainStall(
	/** @type {Target} */ target,
	/** @type {string[]} */ runs,
	/** @type {(message: string) => void} */ log,
) {
	for (const id of runs) {
		try {
			const events = await eventsOf(target, id);
			log(`stalled run ${id}: ${events.length} events; last 8:`);
			for (const e of events.slice(-8)) {
				log(`  ${e.ts} ${e.kind} ${JSON.stringify(e).slice(0, 240)}`);
			}
		} catch (error) {
			log(`could not read run ${id}: ${error}`);
		}
		// The agent's side of the wire: a model that never answered reads differently from a stuck pipeline.
		const wire = target.workspace
			? join(target.workspace, "runs", id, "transcript.jsonl")
			: "";
		if (!wire || !existsSync(wire)) continue;
		const lines = readFileSync(wire, "utf8").trimEnd().split("\n");
		log(`its ACP wire: ${lines.length} lines; last 12:`);
		for (const l of lines.slice(-12)) log(`  ${l.slice(0, 300)}`);
	}
}
