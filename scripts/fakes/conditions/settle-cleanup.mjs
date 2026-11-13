#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// settle.cleanup (#1101): a project thread in its own worktree leaves a wake, a cron and a
// running process (fake session settle-cleanup), then is settled. Once the undo window
// passes, none may remain. Needs the fakes with the gateway (`failure-case.mjs --install`).
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/settle-cleanup.mjs --url http://127.0.0.1:3410 --state-dir <fakes' state dir>
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { arg, connect, sleep, startThread } from "./lib.mjs";
import { writeStamp } from "./stamp.mjs";

/** How long after settling the simulator waits for the thread to hold nothing. */
const TEARDOWN_WAIT_MS = 90_000;

/** @param {number} pid */
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR ?? "";
	const { api } = await connect(url);

	const source = join(workspace, `settle-cleanup-${Date.now()}`);
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	const git = (/** @type {string[]} */ ...a) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=fixture",
				"-c",
				"user.email=fixture@example.invalid",
				...a,
			],
			{ cwd: source },
		);
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const id = await startThread(
		api,
		"settle-cleanup",
		"Keep an eye on checkout",
		{
			kind: "project",
			repositoryId: project.id,
		},
	);
	// The turn stays running; the fake records the pid of what it started in its state dir.
	const spawned = join(
		arg("--state-dir") ?? process.env.PRISMALENS_FAKES_STATE ?? "",
		"spawned",
	);
	const seen = new Set(existsSync(spawned) ? readdirSync(spawned) : []);
	let pid = null;
	for (let i = 0; i < 120 && pid === null; i++) {
		await sleep(500);
		const fresh = existsSync(spawned)
			? readdirSync(spawned).filter((f) => !seen.has(f))
			: [];
		if (fresh[0])
			pid = Number(readFileSync(join(spawned, fresh[0]), "utf8")) || null;
	}
	if (pid === null)
		throw new Error(
			"The fake never started its process; pass the fakes' --state-dir.",
		);
	const run = await api(`/investigations/${id}`);
	const worktree = run.workspace?.cwd ?? null;
	const before = await api(`/threads/${id}/settle-preview`);
	const processBefore = alive(pid);
	const cronBefore = await api(`/threads/${id}/cron`, { ok: [404] });

	const settled = await api(`/threads/${id}/settle`, {
		method: "POST",
		body: { settled: true, stopRunning: true },
	});
	// The teardown runs once the undo window passes; poll until nothing is held.
	const t = Date.now();
	/** @type {any} */
	let after = null;
	/** @type {any} */
	let cron = null;
	let cleanMs = null;
	while (Date.now() - t < TEARDOWN_WAIT_MS) {
		await sleep(1000);
		cron = await api(`/threads/${id}/cron`, { ok: [404] });
		after = await api(`/threads/${id}/settle-preview`, { ok: [404, 409] });
		const held =
			(after?.wakes ?? 0) +
			(after?.watches ?? 0) +
			(after?.crons ?? 0) +
			(cron?.jobs?.length ?? 0) +
			(worktree && existsSync(worktree) ? 1 : 0) +
			(alive(pid) ? 1 : 0);
		if (held === 0) {
			cleanMs = Date.now() - t;
			break;
		}
	}
	const detail = {
		threadId: id,
		before: {
			wakes: before?.wakes ?? null,
			watches: before?.watches ?? null,
			crons: before?.crons ?? null,
			running: before?.running ?? null,
			worktrees: before?.worktrees ?? null,
			processAlive: processBefore,
			cronJobs: cronBefore?.jobs?.length ?? null,
			worktreeExists: worktree ? existsSync(worktree) : null,
		},
		ended: settled?.ended ?? null,
		after: {
			wakes: after?.wakes ?? null,
			watches: after?.watches ?? null,
			crons: after?.crons ?? null,
			cronJobs: cron?.jobs?.length ?? null,
			worktreeExists: worktree ? existsSync(worktree) : null,
			processAlive: alive(pid),
		},
		cleanMs,
		pid,
		worktree,
	};
	console.log(JSON.stringify(detail, null, 2));
	// A process the run left alive is the leak this condition measures; stop it after stamping.
	writeStamp({
		condition: "settle.cleanup",
		simulator: "fake.settle-cleanup",
		observed: {
			processAliveBefore: processBefore,
			processAliveAfter: alive(pid),
			cronJobsBefore: cronBefore?.jobs?.length ?? -1,
			cronJobsAfter: cron?.jobs?.length ?? -1,
			cleanMs: cleanMs ?? -1,
		},
		detail,
	});
	if (pid && alive(pid)) process.kill(pid);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
