#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Seeds the huge-diff thread on a running PrismaLens (#1101 category 16 item 7): a project whose
// source sits at the merge base of --base and --head, and one agent turn during which the head is
// applied in the thread's worktree as uncommitted changes. A rerun reuses the thread it made.
// The server must run the fake agent first on its PATH (`node scripts/fakes/huge-diff.mjs --install <bin-dir>`).
// Keep the workspace path short on Windows: the branch has paths near 110 characters.
// `--measure` then times it on the slow link and writes the huge.diff stamp (huge-diff-measure.mjs).
//   PRISMALENS_WORKSPACE_DIR=<server's workspace> node scripts/fakes/huge-diff.mjs --url http://127.0.0.1:3000 [--measure [--ui <ui url>]]
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeAgent, releaseRun } from "./fake-acp-agent.mjs";

const TITLE = "Review the integration branch";
const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prints where the thread is and, with --measure, measures it and writes the stamp. */
function ready(url, id) {
	console.log(`Huge diff ready: ${url}/threads/${id}?panel=changes`);
	if (!process.argv.includes("--measure")) return;
	const r = spawnSync(
		process.execPath,
		[
			join(HERE, "huge-diff-measure.mjs"),
			"--ui",
			arg("--ui") ?? url,
			"--thread",
			id,
			"--stamp",
		],
		{ stdio: "inherit", env: process.env },
	);
	if (r.status !== 0) process.exitCode = r.status ?? 1;
}

const gitIn =
	(cwd) =>
	(...a) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"-c",
				"core.autocrlf=false",
				"-c",
				"core.longpaths=true",
				...a,
			],
			{ cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		).trim();

async function main() {
	const install = arg("--install");
	if (install) {
		installFakeAgent(install);
		console.log(
			`Fake agents written to ${install}. Start PrismaLens with it first on PATH.`,
		);
		return;
	}
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!workspace)
		throw new Error("Set PRISMALENS_WORKSPACE_DIR to the server's workspace.");
	const here = gitIn(resolve(HERE, "../.."));
	const head = here("rev-parse", arg("--head") ?? "origin/feat/w2-cp");
	const base = here("merge-base", arg("--base") ?? "origin/main", head);
	const common = here("rev-parse", "--git-common-dir");
	const objects = join(
		isAbsolute(common) ? common : resolve(HERE, "../..", common),
		"objects",
	);

	const out = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{ encoding: "utf8", env: process.env },
	);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	if (!token) throw new Error(`No pairing link in:\n${out}`);
	const redeemed = await fetch(`${url}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: url },
		body: JSON.stringify({ token, name: "huge-diff fixture" }),
	});
	const cookie = redeemed.headers
		.getSetCookie()
		.find((c) => c.startsWith("prismalens.device."))
		?.split(";")[0];
	if (!redeemed.ok || !cookie)
		throw new Error(
			`Pairing failed: ${redeemed.status} ${await redeemed.text()}`,
		);
	const api = async (path, init = {}) => {
		const res = await fetch(`${url}/api${path}`, {
			method: init.method ?? "GET",
			headers: { "content-type": "application/json", origin: url, cookie },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const text = await res.text();
		if (!res.ok)
			throw new Error(
				`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
			);
		return text ? JSON.parse(text) : undefined;
	};

	await api("/settings/harness/check", {
		method: "POST",
		body: { id: "claude-code" },
	});
	const harness = await api("/settings/harness");
	if (!harness.harness)
		await api("/settings/harness", {
			method: "PATCH",
			body: { harness: "claude-code" },
		});

	// The source borrows this checkout's objects, so neither side copies the history.
	const source = join(
		workspace,
		`huge-diff-${base.slice(0, 7)}-${head.slice(0, 7)}`,
	);
	if (!existsSync(join(source, ".git"))) {
		mkdirSync(source, { recursive: true });
		const git = gitIn(source);
		git("init", "-q", "-b", "main");
		writeFileSync(
			join(source, ".git", "objects", "info", "alternates"),
			`${objects.replaceAll("\\", "/")}\n`,
		);
		git("config", "core.autocrlf", "false");
		git("update-ref", "refs/heads/main", base);
		git("update-ref", "refs/huge/head", head);
		git("checkout", "-q", "-f", "main");
	}
	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const listed = await api(`/threads?repositoryId=${project.id}&limit=100`);
	const known = listed.data.find((t) => t.title === TITLE);
	if (known) {
		ready(url, known.id);
		return;
	}

	const key = `huge-diff-${Date.now()}`;
	const { investigationId: id } = await api("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: project.id },
			text: `fake-session:huge-diff ${key} apply the integration branch`,
		},
	});
	await api(`/threads/${id}/title`, { method: "POST", body: { title: TITLE } });
	let cwd;
	for (let i = 0; i < 240 && !cwd; i++) {
		const run = await api(`/investigations/${id}`);
		cwd = run.status === "running" ? run.workspace?.cwd : undefined;
		if (!cwd) await sleep(500);
	}
	if (!cwd) throw new Error("The thread never got a worktree");
	// The head's tree into the worktree and back out of the index: every change is uncommitted.
	const wt = gitIn(cwd);
	wt("read-tree", "-u", "--reset", head);
	wt("reset", "-q");
	releaseRun(key);
	for (let i = 0; i < 240; i++) {
		const run = await api(`/investigations/${id}`);
		if (!["pending", "running", "queued"].includes(run.status)) {
			console.log(`Worktree: ${cwd}`);
			ready(url, id);
			return;
		}
		await sleep(500);
	}
	throw new Error("Timed out waiting for the turn to end");
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
