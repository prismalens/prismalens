#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// settle.cleanup (#1101): a project thread in its own worktree leaves a wake, a cron and a
// running process (fake session settle-cleanup), then is settled. Once the undo window
// passes, none may remain. Needs the fakes with the gateway (`failure-case.mjs --install`).
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/settle-cleanup.mjs --url http://127.0.0.1:3410
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ACTIVE,
	arg,
	connect,
	events,
	sleep,
	startThread,
	waitFor,
} from "./lib.mjs";
import { writeStamp } from "./stamp.mjs";

/** The contract's SETTLE_UNDO_MS plus slack for the teardown to run. */
const TEARDOWN_WAIT_MS = 8_000 + 12_000;

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
	const run = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
	const said = (await events(api, id))
		.filter((e) => e.kind === "agent_step")
		.map((e) => e.text ?? "")
		.join("");
	const pid = Number(said.match(/\(pid (\d+)\)/)?.[1] ?? 0) || null;
	const worktree = run.workspace?.cwd ?? null;
	const before = await api(`/threads/${id}/settle-preview`);

	await api(`/threads/${id}/settle`, {
		method: "POST",
		body: { settled: true, stopRunning: true },
	});
	await sleep(TEARDOWN_WAIT_MS);
	const cron = await api(`/threads/${id}/cron`, { ok: [404] });
	const after = await api(`/threads/${id}/settle-preview`, { ok: [404, 409] });
	const observed = {
		threadId: id,
		before: {
			wakes: before?.wakes ?? null,
			watches: before?.watches ?? null,
			crons: before?.crons ?? null,
			worktrees: before?.worktrees ?? null,
			processAlive: pid ? alive(pid) || "exited before settle" : null,
		},
		after: {
			wakes: after?.wakes ?? null,
			watches: after?.watches ?? null,
			crons: after?.crons ?? null,
			cronJobs: Array.isArray(cron?.jobs) ? cron.jobs.length : (cron ?? null),
			worktreeExists: worktree ? existsSync(worktree) : null,
			processAlive: pid ? alive(pid) : null,
		},
		pid,
		worktree,
	};
	console.log(JSON.stringify(observed, null, 2));
	// A process the run left alive is the leak this condition measures; stop it after stamping.
	writeStamp({
		condition: "settle.cleanup",
		simulator: "settle.cleanup",
		profile: {
			holds: ["wake", "cron", "worktree", "process"],
			waitMs: TEARDOWN_WAIT_MS,
		},
		observed,
	});
	if (pid && alive(pid)) process.kill(pid);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
