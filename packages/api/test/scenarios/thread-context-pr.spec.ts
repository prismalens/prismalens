// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	CanonicalEvent,
	ResolvedLinks,
	ThreadContext,
	ThreadFeed,
	ThreadPullRequests,
} from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hostFixture } from "../../src/modules/threads/__fixtures__/fake-host.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const SHA = "d43c4e3ad3c34332c803a568f85f116e3ee58f19";
const GH = "/repos/cli/cli";
const PR_URL = "https://github.com/cli/cli/pull/14927";
const hostCalls: string[] = [];
let thread = "";

/** The git host's API answers from recordings; every other request goes out as usual. */
const realFetch = globalThis.fetch;
const routes: Record<string, unknown> = {
	[`${GH}/pulls/14927`]: hostFixture("github-pull"),
	[`${GH}/pulls/14927/reviews?per_page=100`]: hostFixture("github-reviews"),
	[`${GH}/commits/${SHA}/check-runs?per_page=100`]: hostFixture("github-check-runs"),
	[`${GH}/pulls`]: [],
};

beforeAll(async () => {
	vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.host !== "api.github.com") return realFetch(input, init);
		hostCalls.push(url.pathname + url.search);
		const body = routes[url.pathname + url.search] ?? routes[url.pathname];
		return body === undefined
			? new Response("{}", { status: 404 })
			: new Response(JSON.stringify(body), {
					status: 200,
					headers: { "content-type": "application/json", etag: '"rec"' },
				});
	}) as typeof fetch);
	await pl.boot();
	const repo = join(pl.workspace, "repo-cli");
	mkdirSync(repo, { recursive: true });
	writeFileSync(join(repo, "README.md"), "# cli\n");
	writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
	const git = (...args: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
	git("init", "-q", "-b", "main");
	git("remote", "add", "origin", "https://github.com/cli/cli.git");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	const service = await pl.api<{ id: string }>("/services", {
		method: "POST",
		body: { name: "cli" },
	});
	await pl.api("/repositories/source", {
		method: "POST",
		body: { serviceId: service.id, source: repo },
	});
	const link = await (await pl.prisma()).serviceRepository.findFirstOrThrow({
		where: { serviceId: service.id },
	});
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: {
			subject: { kind: "project", repositoryId: link.repositoryId },
			text: "fake-session:pr Fix the alias command",
		},
	});
	thread = started.investigationId;
	await eventually(
		() => pl.api<{ status: string }>(`/investigations/${thread}`),
		(i) => !["pending", "running", "queued"].includes(i.status),
		"the project thread to finish",
		30_000,
	);
}, 90_000);

afterAll(async () => {
	await pl.dispose();
	vi.unstubAllGlobals();
});

describe("Thread context and pull requests (#1024, surface D)", () => {
	it("Given the agent named a PR, When the run ends, Then it is linked but the host was not called", async () => {
		expect(hostCalls).toEqual([]);
		const prisma = await pl.prisma();
		const rows = await prisma.pullRequest.findMany({ where: { investigationId: thread } });
		// The PR on an unknown repository is never stored.
		expect(rows.map((r) => [r.url, r.source])).toEqual([[PR_URL, "agent"]]);
		const events = (
			await prisma.investigationEvent.findMany({
				where: { investigationId: thread },
				orderBy: { seq: "asc" },
			})
		).map((e) => JSON.parse(e.event) as CanonicalEvent);
		const kinds = events.map((e) => e.kind);
		expect(kinds).toContain("plan");
		expect(kinds).toContain("thought");
		expect(events.find((e) => e.kind === "pull_request_linked")).toMatchObject({
			url: PR_URL,
			source: "agent",
		});
	});

	it("When the panel opens, Then the context serves the project's machine, plan, scripts and PR", async () => {
		const ctx = await pl.api<ThreadContext>(`/threads/${thread}/context`);
		expect(ctx.kind).toBe("project");
		expect(ctx.machine.isHost).toBe(true);
		expect(ctx.plan?.map((e) => e.status)).toEqual(["completed", "in_progress", "pending"]);
		expect(ctx.pullRequests.map((p) => p.number)).toEqual([14927]);
		expect(ctx.workspace?.repos[0]?.head).toMatch(/^[0-9a-f]{40}$/);
		expect(ctx.lineage).toHaveLength(1);
		if (ctx.kind !== "project") throw new Error(ctx.kind);
		expect(ctx.scripts.map((s) => s.name)).toEqual(["test"]);
		expect(hostCalls).toEqual([]);
	});

	it("When the PR section lists, Then state, checks and faces come from the host, cached a minute", async () => {
		const out = await pl.api<ThreadPullRequests>(`/threads/${thread}/pull-requests`);
		expect(out.statusEnabled).toBe(true);
		expect(out.pullRequests[0]).toMatchObject({
			state: "draft",
			tone: "draft",
			checks: { state: "failing", total: 26, failed: 1 },
			author: { login: "williammartin" },
		});
		expect(hostCalls).toContain(`${GH}/pulls/14927`);
		expect(hostCalls.some((c) => c.includes("/evil/"))).toBe(false);
		const n = hostCalls.length;
		await pl.api(`/threads/${thread}/pull-requests`);
		expect(hostCalls).toHaveLength(n);
		const feed = await pl.api<ThreadFeed>("/threads/feed");
		const row = feed.units.flatMap((u) => u.threads).find((t) => t.id === thread);
		// 0ab5288b9 adds the row's PR count.
		expect(row?.pr).toEqual({ number: 14927, tone: "draft", count: 1 });
	});

	it("When prose names paths, a URL and the PR, Then only what exists resolves", async () => {
		const out = await pl.api<ResolvedLinks>(`/threads/${thread}/links/resolve`, {
			method: "POST",
			body: {
				candidates: [
					{ kind: "path", text: "README.md:1" },
					{ kind: "path", text: "src/missing.ts:4" },
					{ kind: "path", text: "../../etc/passwd" },
					{ kind: "url", text: PR_URL },
					{ kind: "thread", text: thread },
				],
			},
		});
		expect(out.targets[0]).toMatchObject({ type: "file", path: "README.md", line: 1 });
		expect(out.targets.slice(1, 3)).toEqual([null, null]);
		expect(out.targets[3]).toMatchObject({
			type: "pull_request",
			pullRequest: { number: 14927 },
		});
		expect(out.targets[4]).toMatchObject({ type: "thread", id: thread, number: null });
	});

	it("When the user pastes a PR on an unknown repository, Then it is refused and never fetched", async () => {
		const res = await pl.fetchRaw(`/threads/${thread}/pull-requests`);
		expect(res.ok).toBe(true);
		const n = hostCalls.length;
		await expect(
			pl.api(`/threads/${thread}/pull-requests`, {
				method: "POST",
				body: { url: "https://github.com.evil.io/cli/cli/pull/1" },
			}),
		).rejects.toThrow();
		expect(hostCalls).toHaveLength(n);
	});

	it("When PR status is turned off, Then a refresh calls no host", async () => {
		await pl.api("/settings/thread-context", {
			method: "PUT",
			body: { prStatus: false, editor: "system" },
		});
		const n = hostCalls.length;
		const out = await pl.api<ThreadPullRequests>(
			`/threads/${thread}/pull-requests/refresh`,
			{ method: "POST" },
		);
		expect(out.statusEnabled).toBe(false);
		expect(hostCalls).toHaveLength(n);
	});
});
