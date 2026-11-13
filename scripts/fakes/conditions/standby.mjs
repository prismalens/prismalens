#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// host.standby (#1101): a thread schedules a wake 10 minutes out, then the laptop "sleeps"
// for 11: the API's wall clock jumps past the wake while its timers did not run. Stamps
// whether the wake fired once the host woke. The API runs with api-preload.mjs (standby).
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/standby.mjs --url http://127.0.0.1:3410 [--skip-min 11]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ACTIVE,
	arg,
	connect,
	events,
	sleep,
	startThread,
	stateDir,
	waitFor,
} from "./lib.mjs";
import { conditionEntry, writeStamp } from "./stamp.mjs";

/** The wake the `wakeup` session schedules. */
const WAKE_S = 600;

async function main() {
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const skipMs = Number(
		conditionEntry("host.standby").profile.skipMs ?? 11 * 60_000,
	);
	const watchMs = Number(arg("--watch-s") ?? 60) * 1000;
	const dir = stateDir("standby");
	if (!existsSync(join(dir, "api.pid")))
		throw new Error(
			"The API is not running with api-preload.mjs and PRISMALENS_CONDITIONS=standby.",
		);
	const { api } = await connect(url);
	const id = await startThread(api, "wakeup", "Watch the rollout");
	await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
	const settled = (await events(api, id)).length;

	const control = join(dir, "skip.json");
	const seq = existsSync(control)
		? JSON.parse(readFileSync(control, "utf8")).seq + 1
		: 1;
	writeFileSync(control, JSON.stringify({ seq, ms: skipMs }));
	const applied = join(dir, "applied.json");
	for (let i = 0; i < 50; i++) {
		if (
			existsSync(applied) &&
			JSON.parse(readFileSync(applied, "utf8")).seq === seq
		)
			break;
		await sleep(200);
	}
	const t = Date.now();
	let wokeAfterMs = null;
	while (Date.now() - t < watchMs) {
		const now = await events(api, id);
		if (now.length > settled) {
			wokeAfterMs = Date.now() - t;
			break;
		}
		await sleep(1000);
	}
	const observed = {
		threadId: id,
		clockSkipApplied:
			existsSync(applied) &&
			JSON.parse(readFileSync(applied, "utf8")).seq === seq,
		wakeFired: wokeAfterMs !== null,
		wokeAfterMs,
		watchedMs: watchMs,
		skipMs,
		wakeDelayS: WAKE_S,
	};
	console.log(JSON.stringify(observed, null, 2));
	writeStamp({
		condition: "host.standby",
		simulator: "clock.standby",
		observed,
	});
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
