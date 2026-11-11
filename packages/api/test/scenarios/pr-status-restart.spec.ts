// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrFeedService } from "../../src/modules/threads/pr-feed.service.js";
import type { PullRequestsService } from "../../src/modules/threads/pull-requests.service.js";
import type { SessionLifecycleService } from "../../src/modules/wakes/session-lifecycle.service.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const realFetch = globalThis.fetch;

let commentsResponse: unknown[] = [];
const checkRunsResponse = {
	total_count: 1,
	check_runs: [
		{
			id: 101,
			name: "build",
			status: "completed",
			conclusion: "failure",
			head_sha: "c111111",
			html_url: "https://ci.example.com/build/1",
		},
	],
};

const pullResponse = {
	title: "Fix bug",
	state: "open",
	mergeable: true,
	head: {
		sha: "c111111",
		ref: "fix-bug",
		repo: { full_name: "acme/shop" },
	},
	base: { ref: "main" },
	user: { login: "alice", avatar_url: null },
	requested_reviewers: [],
	requested_teams: [],
};

beforeAll(async () => {
	vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.host !== "api.github.com") return realFetch(input, init);

		if (url.pathname === "/repos/acme/shop/pulls/123") {
			return new Response(JSON.stringify(pullResponse), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.pathname === "/repos/acme/shop/pulls/123/reviews") {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.pathname === "/repos/acme/shop/commits/c111111/check-runs") {
			return new Response(JSON.stringify(checkRunsResponse), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.pathname === "/repos/acme/shop/issues/123/comments") {
			return new Response(JSON.stringify(commentsResponse), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.pathname === "/repos/acme/shop/pulls/123/comments") {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("{}", { status: 404 });
	}) as typeof fetch);

	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
	vi.unstubAllGlobals();
});

describe("PR status delivery across restart scenario (#1024 surface F)", () => {
	it("a fake git host fixture serves a PR; a failing check is delivered once; restart; a new comment is delivered once and the check line is not repeated", async () => {
		const { PrFeedService } = await import("../../src/modules/threads/pr-feed.service.js");
		const { PullRequestsService } = await import("../../src/modules/threads/pull-requests.service.js");
		const { SessionLifecycleService } = await import("../../src/modules/wakes/session-lifecycle.service.js");

		const prisma = await pl.prisma();
		const now = new Date();

		// Configure repository for trustedRemote
		await prisma.repository.create({
			data: {
				id: "repo-shop",
				fullName: "acme/shop",
				sourceKind: "url",
				url: "https://github.com/acme/shop.git",
			},
		});

		// Create completed thread with workspace pointing to branch fix-bug
		const thread = await prisma.investigation.create({
			data: {
				kind: "chat",
				status: "completed",
				harness: "claude-code",
				title: "PR test thread",
				lastTurnOutcome: "answered",
				workspace: JSON.stringify({
					layout: "single",
					cwd: pl.workspace,
					repos: [
						{
							name: "repo",
							dir: pl.workspace,
							sourceKind: "url",
							url: "https://github.com/acme/shop.git",
							subPath: null,
							connectionId: null,
							head: "c111111",
							branch: "fix-bug",
							services: [],
						},
					],
				}),
			},
		});

		// Create PR and watch feed
		const pr = await prisma.pullRequest.create({
			data: {
				investigationId: thread.id,
				repositoryId: "repo-shop",
				host: "github",
				url: "https://github.com/acme/shop/pull/123",
				repo: "acme/shop",
				number: 123,
				title: "Fix bug",
				source: "branch",
				state: "open",
				headSha: "c111111",
			},
		});

		await prisma.prFeed.create({
			data: {
				prId: pr.id,
				investigationId: thread.id,
				auto: true,
				state: "watching",
				cursor: JSON.stringify({ checks: {}, activity: [] }),
			},
		});

		// Refresh pull-requests service remotes cache
		const prService = pl.resolve<PullRequestsService>(PullRequestsService)!;
		prService.forgetRemotes();

		// 1. First tick polls git host and detects failing check
		const feedService = pl.resolve<PrFeedService>(PrFeedService)!;
		await feedService.tick(now);

		// Wake was scheduled 60s later
		const wake1 = await prisma.threadWake.findFirst({
			where: { investigationId: thread.id, kind: "pr_status", state: "pending" },
		});
		expect(wake1).not.toBeNull();
		expect(wake1?.reason).toContain("PR #123 Fix bug\n- CI failed: build on c111111, log https://ci.example.com/build/1");

		// Deliver the wake via session lifecycle (resumes finished thread)
		const afterBatch1 = new Date(now.getTime() + 61_000);
		const lifecycle = pl.resolve<SessionLifecycleService>(SessionLifecycleService)!;
		await lifecycle.process(afterBatch1);

		// Wake is completed and thread is resumed
		const admittedWake1 = await prisma.threadWake.findUnique({ where: { id: wake1!.id } });
		expect(admittedWake1?.state).toBe("done");

		// Wait for thread to finish before restarting
		await eventually(
			() => pl.api<{ status: string }>(`/investigations/${thread.id}`),
			(i) => i.status === "completed",
			"the thread to complete turn 1",
			30_000,
		);

		// 2. Restart PrismaLens
		await pl.stop();
		await pl.boot();

		// Update git host: failing check still present, but new comment arrives
		commentsResponse = [
			{
				id: 201,
				body: "Could you inspect the failure?",
				created_at: new Date(now.getTime() + 10_000).toISOString(),
				user: { login: "carol", type: "User" },
			},
		];

		const freshFeedService = pl.resolve<PrFeedService>(PrFeedService)!;
		const freshPrService = pl.resolve<PullRequestsService>(PullRequestsService)!;
		freshPrService.forgetRemotes();

		// Tick after restart (e.g. 2 minutes later)
		const restartTime = new Date(now.getTime() + 120_000);
		await freshFeedService.tick(restartTime);

		// Second wake should carry ONLY the new comment, NOT repeating the failing check line
		const freshPrisma = await pl.prisma();
		const wake2 = await freshPrisma.threadWake.findFirst({
			where: {
				investigationId: thread.id,
				kind: "pr_status",
				state: "pending",
				id: { not: wake1!.id },
			},
		});
		expect(wake2).not.toBeNull();
		expect(wake2?.reason).toContain('PR #123 Fix bug\n- New comment from @carol: "Could you inspect the failure?"');
		expect(wake2?.reason.includes("CI failed: build")).toBe(false);

		// Deliver second wake (resumes thread)
		const afterBatch2 = new Date(restartTime.getTime() + 61_000);
		const freshLifecycle = pl.resolve<SessionLifecycleService>(SessionLifecycleService)!;
		await freshLifecycle.process(afterBatch2);

		const admittedWake2 = await freshPrisma.threadWake.findUnique({ where: { id: wake2!.id } });
		expect(admittedWake2?.state).toBe("done");
	}, 90_000);
});
