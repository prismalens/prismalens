#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A dev fixture for #1101 categories 15 and 22: a thread whose PR has failing, running and
// passing checks, a kept log tail and an open review thread, plus schedules with run history
// and a run held by a usage limit. Recorded data only: the PR is on a repository PrismaLens
// does not read, so nothing calls a git host. Run it against a dev workspace, never your own.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prisma } from "@prismalens/database";

const MARK = "fixture:pr-checks";
const BRIEF_END = "(recorded by the PR and checks fixture)";
const SHA = "9f3c2ab71d0e4c55b8a1e2f3d4c5b6a798e0f1a2";
const PR_URL = "https://github.com/acme/shop/pull/412";
const NONE_HASH = createHash("sha256")
	.update(JSON.stringify({ subject: "none" }))
	.digest("hex");

const minutes = (m: number) => new Date(Date.now() + m * 60_000);

const base = (seq: number, threadId: string, branchId = "main") => ({
	runId: threadId,
	branchId,
	path: [],
	label: null,
	seq,
	ts: minutes(-60 + seq).toISOString(),
});

async function clear(): Promise<void> {
	const threads = await prisma.investigation.findMany({
		where: { triggerReason: MARK },
		select: { id: true },
	});
	await prisma.investigation.deleteMany({
		where: { id: { in: threads.map((t) => t.id) } },
	});
	await prisma.schedule.deleteMany({
		where: { brief: { endsWith: BRIEF_END } },
	});
}

async function prThread(): Promise<string> {
	const thread = await prisma.investigation.create({
		data: {
			kind: "chat",
			title: "Fix the slow orders query",
			status: "completed",
			harness: "claude-code",
			triggerType: "manual",
			triggerReason: MARK,
			startedAt: minutes(-60),
			completedAt: minutes(-20),
			lastActivityAt: minutes(-5),
		},
	});
	const id = thread.id;
	const pr = await prisma.pullRequest.create({
		data: {
			investigationId: id,
			host: "github",
			repo: "acme/shop",
			url: PR_URL,
			number: 412,
			title: "Restore the orders index the checkout query lost",
			state: "open",
			review: "changes_requested",
			checks: JSON.stringify({
				state: "failing",
				total: 9,
				failed: 1,
				pending: 1,
			}),
			conflicts: false,
			source: "agent",
			headSha: SHA,
			fetchedAt: new Date(),
			detail: JSON.stringify({
				author: { login: "prismalens-agent" },
				reviewers: [{ login: "dana", state: "changes_requested" }],
				headRef: "fix/orders-index",
				baseRef: "main",
				mergeState: "blocked",
				checkRuns: [
					["build", "passing", "1"],
					["unit tests", "failing", "2"],
					["e2e", "pending", "3"],
					["lint", "passing", "4"],
					["typecheck", "passing", "5"],
					["format", "passing", "6"],
					["docs", "passing", "7"],
					["license", "passing", "8"],
					["bundle size", "passing", "9"],
				].map(([name, state, runId]) => ({
					name,
					state,
					appName: "GitHub Actions",
					id: runId,
					appId: "15368",
					headSha: SHA,
					url: `https://github.com/acme/shop/actions/runs/1101/job/${runId}`,
				})),
				checkLogs: [
					{
						runId: "2",
						headSha: SHA,
						step: "Run pnpm test",
						lines: [
							"> vitest run",
							" RUN  v4.0.0 /home/runner/work/shop/shop",
							" ✓ src/cart/total.test.ts (12 tests) 31ms",
							" FAIL  src/orders/query.test.ts > lists a customer's orders by date",
							"AssertionError: expected 412 ms to be below 200 ms",
							" ❯ src/orders/query.test.ts:48:31",
							"Test Files  1 failed | 41 passed (42)",
							"     Tests  1 failed | 318 passed (319)",
							"##[error]Process completed with exit code 1.",
						],
						unavailable: null,
						fetchedAt: new Date().toISOString(),
					},
				],
				reviewThreads: [
					{
						id: "rt1",
						path: "packages/api/src/orders/query.ts",
						line: 31,
						author: "dana",
						resolved: false,
						outdated: false,
						excerpt:
							"This still sorts in memory. Can the index cover created_at too?",
						replies: 1,
					},
					{
						id: "rt2",
						path: "packages/api/prisma/schema.prisma",
						line: 88,
						author: "lee",
						resolved: true,
						outdated: false,
						excerpt: "Name the index so the migration diff stays readable.",
						replies: 2,
					},
				],
			}),
		},
	});
	await prisma.prFeed.create({
		data: { prId: pr.id, investigationId: id, auto: false, state: "watching" },
	});
	const events = [
		{
			kind: "agent_step",
			...base(1, id),
			text: `The orders list query lost its index in the last migration. I restored it and opened ${PR_URL}.`,
			toolCalls: [],
		},
		{
			kind: "pull_request_linked",
			...base(1, id, "__links__"),
			prId: pr.id,
			url: PR_URL,
			source: "agent",
		},
		{
			kind: "pr_status",
			...base(2, id, "__links__"),
			prId: pr.id,
			pr: "acme/shop#412",
			lines: ["dana requested changes"],
			phase: "noted",
			tone: "attention",
		},
		{
			kind: "pr_status",
			...base(3, id, "__links__"),
			prId: pr.id,
			pr: "acme/shop#412",
			lines: ["unit tests failed on 9f3c2ab"],
			phase: "noted",
			tone: "failing",
		},
	];
	await prisma.investigationEvent.createMany({
		data: events.map((e) => ({
			investigationId: id,
			seq: e.seq,
			branchId: e.branchId,
			event: JSON.stringify(e),
		})),
	});
	return id;
}

async function schedule(
	name: string,
	cron: string,
	runs: Array<{
		hoursAgo: number;
		status: string;
		summary?: string;
		limited?: boolean;
		seen?: boolean;
	}>,
): Promise<string> {
	const s = await prisma.schedule.create({
		data: {
			name,
			kind: "service_check",
			brief: `${name} ${BRIEF_END}`,
			recurrence: JSON.stringify({
				type: "cron",
				expr: cron,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			}),
			harness: "claude-code",
			report: false,
			bindingsHash: NONE_HASH,
			nextRunAt: minutes(24 * 60),
		},
	});
	for (const r of runs) {
		const at = minutes(-r.hoursAgo * 60);
		const run = await prisma.investigation.create({
			data: {
				kind: "chat",
				title: `${name}, ${at.toLocaleString()}`,
				status: r.status,
				summary: r.summary ?? null,
				error: r.limited ? "Usage limit reached" : null,
				endReason: r.limited ? "limited" : null,
				harness: "claude-code",
				scheduleId: s.id,
				scheduleRevision: 1,
				triggerType: "scheduled",
				triggerReason: MARK,
				startedAt: at,
				completedAt: minutes(-r.hoursAgo * 60 + 4),
				lastVisitedAt: r.seen ? minutes(-r.hoursAgo * 60 + 10) : null,
				limitResetsAt: r.limited ? minutes(150) : null,
			},
		});
		if (r.limited)
			await prisma.threadWake.create({
				data: {
					investigationId: run.id,
					kind: "limit",
					at: minutes(152),
					reason: "usage limit",
				},
			});
		await prisma.scheduleTick.create({
			data: {
				scheduleId: s.id,
				scheduledFor: at,
				decidedAt: at,
				outcome: "started",
				investigationId: run.id,
				revision: 1,
			},
		});
	}
	return s.id;
}

export async function fixture(): Promise<void> {
	await clear();
	const thread = await prThread();
	const watch = await schedule("Watch checkout", "0 9 * * 1-5", [
		{
			hoursAgo: 72,
			status: "completed",
			summary: "Nothing wrong found",
			seen: true,
		},
		{
			hoursAgo: 48,
			status: "completed",
			summary: "Nothing wrong found",
			seen: true,
		},
		{ hoursAgo: 24, status: "failed" },
		{
			hoursAgo: 1,
			status: "completed",
			summary: "p99 latency is back under 200 ms",
		},
	]);
	const digest = await schedule("Daily digest", "0 9 * * 1-5", [
		{
			hoursAgo: 24,
			status: "completed",
			summary: "Two deploys, no incidents",
			seen: true,
		},
		{ hoursAgo: 0.5, status: "failed", limited: true },
	]);
	console.log(`fixture: thread /threads/${thread}`);
	console.log(
		`fixture: schedules /schedules/${watch} and /schedules/${digest}`,
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	fixture()
		.catch((err) => {
			console.error("fixture: failed:", err);
			process.exit(1);
		})
		.finally(async () => {
			await prisma.$disconnect();
		});
}
