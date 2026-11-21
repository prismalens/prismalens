#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// host.rewind-crash (#1193): a project thread with three turns (fake session rewind), then the
// state a crash leaves when a rewind wrote a file but never committed: an operation in the
// thread's snapshot store with its backup and target and no settle ref, and the file at its
// target. The server restarts through `pnpm sim restart`, and boot must flag it interrupted.
//   node scripts/fakes/conditions/rewind-interrupted.mjs --url <url>   (inside a `pnpm sim up` run)
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSession } from "../fake-acp-agent.mjs";
import { ACTIVE, arg, connect, events, startThread, waitFor } from "./lib.mjs";
import { REPO_ROOT, writeStamp } from "./stamp.mjs";

const APP_V1 =
	"line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 1\n";
/** src/app.txt after turn 1 of the rewind session: what a rewind of message 2 writes back. */
const AFTER_TURN_1 =
	loadSession("rewind").turns?.[0]?.[1]?.write?.content ?? "";

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

/** @param {string} cwd @param {string[]} args @param {Record<string, string>} [env] @param {string} [input] */
const git = (cwd, args, env = {}, input) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...IDENTITY, ...env },
		...(input === undefined ? {} : { input }),
		windowsHide: true,
	}).trim();

/** The worktree's files as one commit in the store, through a scratch index. */
function snapshot(
	/** @type {string} */ gitDir,
	/** @type {string} */ cwd,
	/** @type {string} */ scratch,
) {
	const env = { GIT_DIR: gitDir, GIT_WORK_TREE: cwd, GIT_INDEX_FILE: scratch };
	rmSync(scratch, { force: true });
	git(cwd, ["add", "-A", "."], env);
	const tree = git(cwd, ["write-tree"], env);
	return git(cwd, ["commit-tree", tree, "-m", "fixture snapshot"], env);
}

async function main() {
	const url = (arg("--url") ?? "").replace(/\/$/, "");
	if (!url) throw new Error("Pass --url <the sim's app URL>.");
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!workspace)
		throw new Error("Set PRISMALENS_WORKSPACE_DIR to the server's workspace.");
	let { api } = await connect(url);

	const source = join(workspace, `rewind-shop-${Date.now()}`);
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), APP_V1);
	git(source, ["init", "-q", "-b", "main"]);
	git(source, ["add", "."]);
	git(source, ["commit", "-q", "-m", "init"]);
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const id = await startThread(api, "rewind", "Raise the checkout retries", {
		kind: "project",
		repositoryId: project.id,
	});
	const idle = (/** @type {string} */ what) =>
		waitFor(api, id, (r) => !ACTIVE.includes(r.status), 90_000, what);
	const first = await idle("turn 1");
	const cwd = first.workspace?.cwd;
	const repo = first.workspace?.repos?.[0]?.name;
	if (!cwd || !repo) throw new Error("The thread has no worktree");
	writeFileSync(join(cwd, "README.md"), "# shop\n\nEdited by hand.\n");
	for (const text of ["Set the retries to 3", "Set the retries to 4"]) {
		await api(`/investigations/${id}/messages`, {
			method: "POST",
			body: { text },
		});
		await idle(text);
	}

	// The crash: backup and target recorded, the file written, nothing settled.
	const gitDir = join(workspace, "snapshots", id, "0.git");
	const scratch = join(workspace, `rewind-fixture-${process.pid}.index`);
	const backup = snapshot(gitDir, cwd, scratch);
	const app = join(cwd, "src", "app.txt");
	const before = readFileSync(app, "utf8");
	writeFileSync(app, AFTER_TURN_1);
	const target = snapshot(gitDir, cwd, scratch);
	rmSync(scratch, { force: true });
	const op = randomUUID();
	const empty = git(cwd, ["mktree"], { GIT_DIR: gitDir }, "");
	const meta = git(
		cwd,
		[
			"commit-tree",
			empty,
			"-m",
			JSON.stringify({ kind: "rewind", rewindId: null, thread: id, repo }),
		],
		{ GIT_DIR: gitDir },
	);
	for (const [k, sha] of /** @type {const} */ ([
		["meta", meta],
		["backup", backup],
		["target", target],
	]))
		git(cwd, ["update-ref", `refs/pl/op/${op}/${k}`, sha], { GIT_DIR: gitDir });

	const out = execFileSync(
		process.execPath,
		[join(REPO_ROOT, "scripts/sim/sim.mjs"), "restart"],
		{ cwd: REPO_ROOT, encoding: "utf8", env: process.env },
	);
	const restartMs = Number(out.match(/in (\d+) ms/)?.[1] ?? -1);
	({ api } = await connect(url));
	let flagged = null;
	for (let i = 0; i < 60 && !flagged; i++) {
		flagged =
			(await events(api, id)).find(
				(e) => e.kind === "rewind_interrupted" && e.op === op,
			) ?? null;
		if (!flagged) await new Promise((r) => setTimeout(r, 500));
	}
	const observed = {
		interrupted: flagged ? 1 : 0,
		written: flagged?.written?.length ?? 0,
		restartMs,
	};
	console.log(`Thread: ${url}/threads/${id}`);
	console.log(JSON.stringify({ ...observed, op, before }, null, 2));
	writeStamp({
		condition: "host.rewind-interrupted",
		simulator: "host.rewind-crash",
		observed,
		detail: { id, op, repo, backup, target, restartMs },
	});
	if (!flagged)
		throw new Error("after the restart no rewind_interrupted row was appended");
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
