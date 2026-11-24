#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Packed intake e2e (#630): the core journeys (scripts/journeys) run on the INSTALLED
 * tarball. `packed-smoke.sh` proves the tarball boots; this proves what a user does with
 * it: an alert becomes an incident, the app investigates it unattended and ends with a
 * report citing real files, a resolution closes it, and a restart resumes a cut-off run.
 * The same journeys run in-process in vitest (packages/api/test/journeys).
 *
 * Usage: packed-intake.mjs <dir-with-tarball>
 *   The dir must hold the single published tarball from `node scripts/pack-cli.mjs`,
 *   the SAME artifact packed-smoke verifies. PRISMALENS_TARBALL overrides with an exact
 *   path (CI reuse). What is installed is the npm launcher, running this runner's archive
 *   of that tarball from a local release mirror (#717).
 *
 * Env: PACKED_INTAKE_PORT (default 3102). PACKED_INTAKE_REPO: a git checkout to
 * investigate; "fixture" or unset is the small built-in repo (#876).
 * PRISMALENS_HARNESS_MODEL (optional, the model id set on the harness).
 * PACKED_INTAKE_AGENT: "live" (default) is the live target, the harness on PATH;
 * "fake" is the packed target, the scripted ACP agent (scripts/fakes/sessions) on PATH
 * as `opencode`, which needs the built-in fixture repo (#884).
 * PACKED_INTAKE_JOURNEYS: comma-separated journey names; default all of them.
 * PACKED_INTAKE_EVENTS_OUT=<file> writes the alert-to-report run's paged event stream
 * there once it ends, completed or not; the nightly tier uploads it (#533).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { journeys, runJourneys } from "./journeys/index.mjs";
import { eventsOf } from "./journeys/lib.mjs";
import {
	findTarball,
	openPackedTarget,
	packedConfig,
} from "./journeys/targets/packed.mjs";
import { targetGuard } from "./lib/target-guard.mjs";

const log = (/** @type {string} */ message) =>
	console.log(`[packed-intake] ${message}`);

/** The event stream to PACKED_INTAKE_EVENTS_OUT (#533); throws so a completed attempt without its recording fails. */
async function saveEvents(
	/** @type {import("./journeys/types.mjs").Target} */ app,
	/** @type {string} */ out,
	/** @type {string} */ id,
) {
	try {
		const events = await eventsOf(app, id);
		mkdirSync(dirname(resolve(out)), { recursive: true });
		const body = JSON.stringify({ investigationId: id, events }, null, 2);
		writeFileSync(resolve(out), `${body}\n`);
		log(`saved ${events.length} events to ${out}`);
	} catch (error) {
		console.error(`[packed-intake] could not save the event stream: ${error}`);
		throw error;
	}
}

/**
 * The whole run, with its collaborators passed in so a test can cancel during boot.
 * @param {{ guard: ReturnType<typeof targetGuard>, openTarget?: typeof openPackedTarget, run?: typeof runJourneys, env?: NodeJS.ProcessEnv, argv?: string[] }} deps
 */
export async function main({
	guard,
	openTarget = openPackedTarget,
	run = runJourneys,
	env = process.env,
	argv = process.argv,
}) {
	const config = packedConfig(env);
	const known = journeys.map((j) => j.name);
	const wanted = config.journeys ?? known;
	const unknown = wanted.filter((name) => !known.includes(name));
	if (unknown.length > 0) {
		throw new Error(
			`PACKED_INTAKE_JOURNEYS names no journey ${unknown.join(", ")}; known: ${known.join(", ")}`,
		);
	}
	const tgz = findTarball(argv[2], env);
	const app = await guard.adopt(await openTarget({ ...config, tgz }, log));
	/** @type {Map<string, string[]>} */
	const ran = new Map();
	let failure;
	try {
		await run(
			app,
			journeys.filter((j) => wanted.includes(j.name)),
			log,
			ran,
		);
	} catch (error) {
		failure = error;
	}
	const recorded = ran.get("alert-to-report")?.[0];
	const exportError =
		config.eventsOut && recorded
			? await saveEvents(app, config.eventsOut, recorded).then(
					() => undefined,
					(error) => error,
				)
			: undefined;
	if (failure) throw failure;
	if (exportError) throw exportError;
	console.log("PACKED INTAKE OK");
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const guard = targetGuard();
	process.on("SIGINT", () => void guard.cleanup(130));
	process.on("SIGTERM", () => void guard.cleanup(143));
	main({ guard })
		.then(() => guard.cleanup(0))
		.catch((error) => {
			console.error(`INTAKE FAIL: ${error?.stack ?? error}`);
			return guard.cleanup(1);
		});
}
