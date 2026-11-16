#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// host.restart (#1101): two threads mid-turn, then the server restarts under them through
// `pnpm sim restart`. With Resume after a restart off, both read Interrupted with Resume; the
// first is resumed twice at once to prove it resumes once, the second is left for the walk.
//   node scripts/fakes/conditions/host-restart.mjs --url <url>   (inside a `pnpm sim up` run)
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { arg, connect, sleep, startThread, waitFor } from "./lib.mjs";
import { REPO_ROOT, writeStamp } from "./stamp.mjs";

/** A session that speaks, runs one tool and then holds its turn open until released. */
const SESSION = "live-stuck";

/** @param {(p: string, i?: any) => Promise<any>} api @param {string} id */
async function statusOf(api, id) {
	const { statuses } = await api("/threads/statuses", {
		method: "POST",
		body: { ids: [id] },
	});
	return statuses?.[id]?.status ?? null;
}

/** @param {(p: string, i?: any) => Promise<any>} api @param {string} id @param {string} want */
async function until(api, id, want, ms = 60_000) {
	const end = Date.now() + ms;
	let seen = null;
	while (Date.now() < end) {
		seen = await statusOf(api, id);
		if (seen === want) return seen;
		await sleep(500);
	}
	return seen;
}

async function main() {
	const url = (arg("--url") ?? "").replace(/\/$/, "");
	if (!url) throw new Error("Pass --url <the sim's app URL>.");
	let { api } = await connect(url);
	// A restart with this on resumes every run on its own; the walk needs one left Interrupted.
	await api("/settings/harness", {
		method: "PATCH",
		body: { resumeAfterRestart: false },
	});
	const proof = await startThread(api, SESSION, "Drain the retry queue");
	const walk = await startThread(api, SESSION, "Rebuild the search index");
	for (const id of [proof, walk])
		await waitFor(api, id, (r) => r.status === "running", 60_000, "a run");
	// Its tool call lands first, so the restart cuts off a turn with work in it.
	await sleep(3000);

	const out = execFileSync(
		process.execPath,
		[join(REPO_ROOT, "scripts/sim/sim.mjs"), "restart"],
		{ cwd: REPO_ROOT, encoding: "utf8", env: process.env },
	);
	const restartMs = Number(out.match(/in (\d+) ms/)?.[1] ?? -1);
	// The pairing cookie lives in the database, but pair again so a new process key never matters.
	({ api } = await connect(url));
	const after = {
		proof: await until(api, proof, "interrupted"),
		walk: await until(api, walk, "interrupted"),
	};

	// Two Resume presses at once: one is taken, the other is refused.
	const presses = await Promise.all(
		[0, 1].map(() =>
			api(`/investigations/${proof}/resume`, {
				method: "POST",
				body: {},
				ok: [409],
			}).then(
				(r) =>
					r?.status === 409 || r?.code === "CONFLICT" ? "refused" : "taken",
				() => "refused",
			),
		),
	);
	const taken = presses.filter((p) => p === "taken").length;
	const resumed = await until(api, proof, "working", 60_000);
	// The proof thread has made its point; stop it so it does not read Working all night.
	await api(`/investigations/${proof}/cancel`, {
		method: "POST",
		body: {},
		ok: [404, 409],
	});

	const interrupted = Object.values(after).filter(
		(s) => s === "interrupted",
	).length;
	const observed = {
		threads: 2,
		interrupted,
		resumedOnce: taken === 1 && resumed === "working",
		restartMs,
	};
	console.log(`Thread: ${url}/threads/${walk}`);
	console.log(
		JSON.stringify({ ...observed, after, presses, resumed }, null, 2),
	);
	writeStamp({
		condition: "host.restart",
		simulator: "host.restart",
		observed,
		detail: { proof, walk, after, presses, resumed, restartMs },
	});
	if (interrupted !== 2)
		throw new Error(
			`after the restart the threads read ${JSON.stringify(after)}, not Interrupted`,
		);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
