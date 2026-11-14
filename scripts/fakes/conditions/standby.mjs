#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// host.standby (#1101): `stage` starts a thread that schedules a wake 10 minutes out; `skip`
// is the laptop sleeping past it: the API's wall clock jumps while its timers did not run,
// and the stamp says whether the wake fired once the host woke. The API runs api-preload.mjs.
//   node scripts/fakes/conditions/standby.mjs stage --url <url> [--prove]
//   node scripts/fakes/conditions/standby.mjs skip --url <url>
// `--prove` (what `pnpm sim up` runs) sleeps through one skip on a first thread and stamps it,
// then stages a fresh thread for the person, so a run is stamped before anyone presses Skip.
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
const DIR = stateDir("standby");
const STAGED = join(DIR, "thread.json");

/** @param {any} api @param {string} url */
async function stage(api, url, title = "Watch the rollout") {
	if (!existsSync(join(DIR, "api.pid")))
		throw new Error(
			"The API is not running with api-preload.mjs and PRISMALENS_CONDITIONS=standby.",
		);
	const id = await startThread(api, "wakeup", title);
	await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
	const settled = (await events(api, id)).length;
	writeFileSync(STAGED, JSON.stringify({ id, settled }));
	console.log(`Thread: ${url}/threads/${id}`);
	return { id, settled };
}

/** @param {any} api @param {{ id: string, settled: number }} staged */
async function skip(api, staged) {
	const skipMs = Number(
		conditionEntry("host.standby").profile.skipMs ?? 11 * 60_000,
	);
	const watchMs = Number(arg("--watch-s") ?? 60) * 1000;
	const control = join(DIR, "skip.json");
	const seq = existsSync(control)
		? JSON.parse(readFileSync(control, "utf8")).seq + 1
		: 1;
	writeFileSync(control, JSON.stringify({ seq, ms: skipMs }));
	const applied = join(DIR, "applied.json");
	const appliedSeq = () =>
		existsSync(applied) ? JSON.parse(readFileSync(applied, "utf8")).seq : 0;
	for (let i = 0; i < 50 && appliedSeq() !== seq; i++) await sleep(200);
	const t = Date.now();
	let wokeAfterMs = null;
	while (Date.now() - t < watchMs) {
		if ((await events(api, staged.id)).length > staged.settled) {
			wokeAfterMs = Date.now() - t;
			break;
		}
		await sleep(1000);
	}
	const observed = {
		threadId: staged.id,
		clockSkipApplied: appliedSeq() === seq,
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

async function main() {
	const cmd = process.argv[2];
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const { api } = await connect(url);
	if (cmd === "stage" && process.argv.includes("--prove"))
		await skip(api, await stage(api, url, "Watch the canary"));
	if (cmd === "stage") return void (await stage(api, url));
	// A skip with nothing staged stages first, so the one command still works alone.
	const staged =
		cmd === "skip" && existsSync(STAGED)
			? JSON.parse(readFileSync(STAGED, "utf8"))
			: await stage(api, url);
	await skip(api, staged);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
