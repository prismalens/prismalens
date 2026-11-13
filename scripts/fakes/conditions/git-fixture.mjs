#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Git conditions on a project thread's own worktree (#1101): git.conflict, git.force-push,
// git.branch-deleted, git.worktree-disk. Each makes a fresh repo with a bare remote, runs a
// thread on it (fake session diff-turns), then induces the state and stamps what git shows.
// worktree-disk needs the API started with api-preload.mjs and PRISMALENS_CONDITIONS=low-disk.
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/git-fixture.mjs git.conflict --url http://127.0.0.1:3410
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIVE, arg, connect, events, startThread, waitFor } from "./lib.mjs";
import { writeStamp } from "./stamp.mjs";

const APP_V1 =
	"line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 1\n";

/** @param {string} cwd @param {string[]} a */
const git = (cwd, ...a) =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=fixture",
			"-c",
			"user.email=fixture@example.invalid",
			...a,
		],
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
/** @param {string} cwd @param {string[]} a */
const gitTry = (cwd, ...a) => {
	try {
		return git(cwd, ...a);
	} catch (e) {
		return String(/** @type {{ stdout?: string }} */ (e).stdout ?? "");
	}
};

/** The worktree's branch; a detached worktree is put on one named for its thread. */
function branchOf(/** @type {string} */ cwd, /** @type {string} */ id) {
	const current = git(cwd, "branch", "--show-current");
	if (current) return current;
	const name = `thread-${id.slice(0, 8)}`;
	git(cwd, "switch", "-q", "-c", name);
	return name;
}

/** A source repo with a bare `origin`, both under the server's workspace. */
function makeRepo(/** @type {string} */ workspace, /** @type {string} */ name) {
	const root = join(workspace, `git-fixture-${name}-${Date.now()}`);
	const source = join(root, "shop");
	const remote = join(root, "origin.git");
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), APP_V1);
	git(root, "init", "-q", "--bare", "-b", "main", remote);
	git(source, "init", "-q", "-b", "main");
	git(source, "add", ".");
	git(source, "commit", "-q", "-m", "init");
	git(source, "remote", "add", "origin", remote);
	git(source, "push", "-q", "origin", "main");
	return { root, source, remote };
}

/** @param {any} api @param {string} source */
async function threadOn(api, source) {
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const id = await startThread(
		api,
		"diff-turns",
		"Raise the checkout timeout",
		{
			kind: "project",
			repositoryId: project.id,
		},
	);
	const run = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
	return { id, run };
}

/** @type {Record<string, (ctx: { api: any, workspace: string }) => Promise<Record<string, unknown>>>} */
const FIXTURES = {
	async "git.conflict"({ api, workspace }) {
		const { source } = makeRepo(workspace, "conflict");
		const { id, run } = await threadOn(api, source);
		const cwd = run.workspace?.cwd;
		if (!cwd) throw new Error("The thread has no worktree");
		git(cwd, "add", "-A");
		git(cwd, "commit", "-q", "-m", "agent: raise timeout");
		writeFileSync(
			join(source, "src", "app.txt"),
			APP_V1.replace("timeout = 5", "timeout = 60"),
		);
		git(source, "commit", "-q", "-am", "main: timeout 60");
		gitTry(cwd, "merge", "main");
		const unmerged = git(cwd, "diff", "--name-only", "--diff-filter=U")
			.split("\n")
			.filter(Boolean);
		return { threadId: id, worktree: cwd, unmerged };
	},
	async "git.force-push"({ api, workspace }) {
		const { root, source, remote } = makeRepo(workspace, "force");
		const { id, run } = await threadOn(api, source);
		const cwd = run.workspace?.cwd;
		if (!cwd) throw new Error("The thread has no worktree");
		const branch = branchOf(cwd, id);
		git(cwd, "add", "-A");
		git(cwd, "commit", "-q", "-m", "agent: raise timeout");
		git(cwd, "push", "-q", remote, `HEAD:refs/heads/${branch}`);
		// Someone else rewrites the pushed branch.
		const other = join(root, "other");
		git(root, "clone", "-q", "-b", branch, remote, other);
		git(other, "commit", "-q", "--amend", "-m", "rewritten elsewhere");
		git(other, "push", "-q", "--force", "origin", branch);
		git(
			cwd,
			"fetch",
			"-q",
			remote,
			`+refs/heads/${branch}:refs/remotes/fixture/${branch}`,
		);
		const [ahead, behind] = git(
			cwd,
			"rev-list",
			"--left-right",
			"--count",
			`HEAD...fixture/${branch}`,
		)
			.split(/\s+/)
			.map(Number);
		return { threadId: id, worktree: cwd, branch, ahead, behind };
	},
	async "git.branch-deleted"({ api, workspace }) {
		const { source, remote } = makeRepo(workspace, "deleted");
		const { id, run } = await threadOn(api, source);
		const cwd = run.workspace?.cwd;
		if (!cwd) throw new Error("The thread has no worktree");
		const branch = branchOf(cwd, id);
		git(cwd, "push", "-q", remote, `HEAD:refs/heads/${branch}`);
		git(source, "push", "-q", "origin", "--delete", branch);
		const onRemote = git(source, "ls-remote", "--heads", "origin", branch);
		return { threadId: id, worktree: cwd, branch, onRemote: onRemote !== "" };
	},
	async "git.worktree-disk"({ api, workspace }) {
		const { source } = makeRepo(workspace, "disk");
		const project = await api("/repositories/source", {
			method: "POST",
			body: { source },
		});
		const id = await startThread(
			api,
			"diff-turns",
			"Raise the checkout timeout",
			{
				kind: "project",
				repositoryId: project.id,
			},
		);
		const run = await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
		const evs = await events(api, id);
		const errors = evs
			.filter((e) => e.kind === "error" || e.kind === "run_failed")
			.map((e) => e.message ?? e.reason ?? e.kind);
		return {
			threadId: id,
			status: run.status,
			worktree: run.workspace?.cwd ?? null,
			worktreeExists: run.workspace?.cwd
				? existsSync(run.workspace.cwd)
				: false,
			errors,
		};
	},
};

async function main() {
	const condition = process.argv[2];
	const make = condition ? FIXTURES[condition] : undefined;
	if (!make) {
		console.log(
			`Usage: git-fixture.mjs <${Object.keys(FIXTURES).join("|")}> --url <base>`,
		);
		process.exitCode = condition ? 1 : 0;
		return;
	}
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR ?? "";
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const { api } = await connect(url);
	const observed = await make({ api, workspace });
	console.log(JSON.stringify(observed, null, 2));
	console.log(`Thread: ${url}/threads/${observed.threadId}?panel=changes`);
	writeStamp({
		condition,
		simulator:
			condition === "git.worktree-disk" ? "api.low-disk" : "git.fixture",
		profile:
			condition === "git.worktree-disk"
				? { freeBytes: 20 * 1024 * 1024, worktreeAdd: "ENOSPC" }
				: { state: condition.slice(4) },
		observed,
	});
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
