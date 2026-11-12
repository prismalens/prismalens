#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Seeds the diff fixture on a running PrismaLens (#1101 category 16): a project thread in its own
// worktree, two agent turns (fake session diff-turns), a hand edit between them and an untracked file.
// The server must run the fake agent first on its PATH (`node scripts/fakes/diff-turns.mjs --install <bin-dir>`).
//   PRISMALENS_WORKSPACE_DIR=<server's workspace> node scripts/fakes/diff-turns.mjs --url http://127.0.0.1:3000
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeAgent } from "./fake-acp-agent.mjs";

const APP_V1 =
	"line 1\nline 2\ntimeout = 5\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 1\n";

function arg(name) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

	// Pair as the host's own browser does: an operator link from `pl pair --operator`.
	const out = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{
			encoding: "utf8",
			env: process.env,
		},
	);
	const token = out.match(/\/pair#([^\s#]+)/)?.[1];
	if (!token) throw new Error(`No pairing link in:\n${out}`);
	const redeemed = await fetch(`${url}/api/pairing/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: url },
		body: JSON.stringify({ token, name: "diff-turns fixture" }),
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
	const idle = async (id, what, extra = () => true) => {
		for (let i = 0; i < 120; i++) {
			const run = await api(`/investigations/${id}`);
			if (!["pending", "running", "queued"].includes(run.status) && extra(run))
				return run;
			await sleep(500);
		}
		throw new Error(`Timed out waiting for ${what}`);
	};

	// The fake agent answers as Claude Code; a server with no agent chosen takes it.
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

	const source = join(workspace, `diff-turns-shop-${Date.now()}`);
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "README.md"), "# shop\n");
	writeFileSync(join(source, "src", "app.txt"), APP_V1);
	const git = (...a) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=fixture",
				"-c",
				"user.email=fixture@example.invalid",
				...a,
			],
			{
				cwd: source,
			},
		);
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");

	const project = await api("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const { investigationId: id } = await api("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: project.id },
			text: "fake-session:diff-turns fix the timeout",
		},
	});
	const first = await idle(id, "the first turn");
	const cwd = first.workspace?.cwd;
	if (!cwd) throw new Error("The thread has no worktree");
	writeFileSync(join(cwd, "README.md"), "# shop\n\nEdited by hand.\n");
	await api(`/investigations/${id}/messages`, {
		method: "POST",
		body: { text: "Retries look low" },
	});
	await idle(id, "the second turn", () => {
		try {
			return readFileSync(join(cwd, "NOTES.md"), "utf8").length > 0;
		} catch {
			return false;
		}
	});
	console.log(`Diff fixture ready: ${url}/threads/${id}?panel=changes`);
	console.log(`Worktree: ${cwd}`);
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
