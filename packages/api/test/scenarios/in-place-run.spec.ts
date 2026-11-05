// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseRun } from "../../../../scripts/fakes/fake-acp-agent.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const checkout = join(pl.workspace, "my-shop");
const git = (...args: string[]) =>
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		cwd: checkout,
		encoding: "utf8",
	}).trim();
const seen: string[][] = [];
// Release files outlive a run, so each run holds on its own key.
const HOLD = `hold-${randomUUID().slice(0, 8)}`;
let projectId = "";
let threadId = "";
let before: { head: string; stash: string; status: string };

const live = (s: string) => ["pending", "running", "queued"].includes(s);
const settled = (id: string) =>
	eventually(
		() => pl.api<{ status: string }>(`/investigations/${id}`),
		(i) => !live(i.status),
		`run ${id} to finish`,
		30_000,
	);

async function refusal(path: string, body: unknown): Promise<string> {
	try {
		await pl.api(path, { method: "POST", body });
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error(`${path} was accepted`);
}

beforeAll(async () => {
	await pl.boot();
	// The user's own checkout: a stash entry, an edited file and an untracked one.
	mkdirSync(join(checkout, "src"), { recursive: true });
	writeFileSync(join(checkout, "README.md"), "# shop\n");
	writeFileSync(join(checkout, "src", "app.txt"), "v1\n");
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	writeFileSync(join(checkout, "src", "app.txt"), "stashed\n");
	git("stash", "push", "-q", "-m", "mine");
	writeFileSync(join(checkout, "src", "app.txt"), "v2 in progress\n");
	writeFileSync(join(checkout, "notes.txt"), "draft\n");
	before = {
		head: git("rev-parse", "HEAD"),
		stash: git("stash", "list"),
		status: git("status", "--porcelain"),
	};
	const project = await pl.api<{ id: string }>("/repositories/source", {
		method: "POST",
		body: { source: checkout },
	});
	projectId = project.id;
	const { setCheckoutGit } = await import(
		"../../src/infrastructure/dispatch/checkout-lease.js"
	);
	const { spawnGit } = await import("../../src/core/harness/git-spawn.js");
	setCheckoutGit((args, opts) => {
		seen.push(args);
		return spawnGit(args, opts);
	});
}, 60_000);

afterAll(async () => {
	const { setCheckoutGit } = await import(
		"../../src/infrastructure/dispatch/checkout-lease.js"
	);
	setCheckoutGit(null);
	await pl.dispose();
});

describe("A thread works in the user's own checkout (#1024)", () => {
	it("Given a local git project, When a person starts a thread in This checkout, Then the agent writes in the checkout itself", async () => {
		const started = await pl.api<{ investigationId: string }>("/threads", {
			method: "POST",
			body: {
				subject: { kind: "project", repositoryId: projectId },
				text: `fake-session:in-place ${HOLD}: add a note`,
				workIn: "checkout",
			},
		});
		threadId = started.investigationId;
		await eventually(
			async () => existsSync(join(checkout, "pl-in-place.txt")),
			Boolean,
			"the agent's file in the checkout",
			30_000,
		);
		expect(readFileSync(join(checkout, "pl-in-place.txt"), "utf8")).toBe(
			"written in place\n",
		);
		const prisma = await pl.prisma();
		const repo = await prisma.repository.findUniqueOrThrow({ where: { id: projectId } });
		expect(repo.workIn).toBe("checkout");
	}, 60_000);

	it("While it works, Then a second thread in the checkout is refused and a new worktree is not", async () => {
		const message = await refusal("/threads", {
			subject: { kind: "project", repositoryId: projectId },
			text: "a second thread",
			workIn: "checkout",
		});
		expect(message).toContain("409");
		expect(message).toContain("already working in this checkout");

		const other = await pl.api<{ investigationId: string }>("/threads", {
			method: "POST",
			body: {
				subject: { kind: "project", repositoryId: projectId },
				text: "in a worktree instead",
				workIn: "worktree",
			},
		});
		await settled(other.investigationId);
		const prisma = await pl.prisma();
		const row = await prisma.investigation.findUniqueOrThrow({
			where: { id: other.investigationId },
		});
		expect(JSON.parse(row.workspace ?? "{}").layout).toBe("single");
	}, 60_000);

	it("When the run finishes, Then its workspace, the borrowed event and its changes name the checkout, and nothing in it was reset", async () => {
		releaseRun(HOLD);
		expect((await settled(threadId)).status).toBe("completed");
		const prisma = await pl.prisma();
		const row = await prisma.investigation.findUniqueOrThrow({ where: { id: threadId } });
		const ws = JSON.parse(row.workspace ?? "{}");
		expect(ws.layout).toBe("in_place");
		expect(ws.borrowed).toMatchObject({
			head: before.head,
			branch: "main",
			dirty: { staged: 0, unstaged: 1, untracked: 1 },
		});
		const events = JSON.stringify(await pl.api(`/investigations/${threadId}/events`));
		expect(events).toContain("workspace_borrowed");
		expect(events).not.toContain("draft");

		const changes = await pl.api<{ repos: Array<{ files: Array<{ path: string }> }> }>(
			`/investigations/${threadId}/changes`,
		);
		const paths = changes.repos.flatMap((r) => r.files.map((f) => f.path));
		expect(paths).toEqual(expect.arrayContaining(["pl-in-place.txt", "src/app.txt"]));

		expect(git("rev-parse", "HEAD")).toBe(before.head);
		expect(git("stash", "list")).toBe(before.stash);
		expect(readFileSync(join(checkout, "src", "app.txt"), "utf8")).toBe("v2 in progress\n");
		expect(readFileSync(join(checkout, "notes.txt"), "utf8")).toBe("draft\n");
		// The worktree thread's snapshot lives under app data; the checkout stays the main tree.
		const trees = git("worktree", "list", "--porcelain")
			.split("\n")
			.filter((l) => l.startsWith("worktree "))
			.map((l) => l.slice("worktree ".length).toLowerCase());
		const slash = (p: string) => p.replaceAll("\\", "/").toLowerCase();
		expect(trees[0]).toBe(slash(checkout));
		for (const t of trees.slice(1)) expect(t).toContain(slash(join(pl.workspace, "data")));
		expect(new Set(seen.map((a) => a[0]))).toEqual(
			new Set(["rev-parse", "symbolic-ref", "status"]),
		);
	}, 60_000);

	it("When the person sends a follow-up, Then it reopens in the same checkout", async () => {
		const sent = await pl.api<{ state: string }>(`/investigations/${threadId}/messages`, {
			method: "POST",
			body: { text: "Add one more note", workIn: "checkout" },
		});
		expect(sent.state).toBe("resumed");
		expect((await settled(threadId)).status).toBe("completed");
		expect(readFileSync(join(checkout, "pl-follow-up.txt"), "utf8")).toBe("follow-up\n");
		expect(git("rev-parse", "HEAD")).toBe(before.head);
		expect(git("stash", "list")).toBe(before.stash);
	}, 60_000);

	it("A follow-up asking for a worktree is refused: the thread never moves", async () => {
		const message = await refusal(`/investigations/${threadId}/messages`, {
			text: "now in a worktree",
			workIn: "worktree",
		});
		expect(message).toContain("409");
		expect(message).toContain("works in your checkout");
	});

	it("When the checkout has moved, Then a follow-up is refused with the reason", async () => {
		renameSync(checkout, `${checkout}-moved`);
		try {
			const message = await refusal(`/investigations/${threadId}/messages`, {
				text: "still there?",
			});
			expect(message).toContain("409");
			expect(message).toContain("is gone or is now somewhere else");
		} finally {
			renameSync(`${checkout}-moved`, checkout);
		}
		expect(git("rev-parse", "HEAD")).toBe(before.head);
	});
});
