#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A dev fixture for #1101 categories 15 and 22 on a running PrismaLens with the fake agent on its
// PATH: a project thread in its own worktree whose PR has failing, running and passing checks, a
// kept log tail and review threads on a file the thread changed, plus schedules with run history
// and a run held by a usage limit. The PR's host data is recorded: nothing calls a git host.
//   PRISMALENS_WORKSPACE_DIR=<server's workspace> pnpm --filter @prismalens/api fixture:pr-checks --url http://127.0.0.1:3311
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@prismalens/database";
import { firstSlotAtOrAfter } from "../src/modules/schedules/recurrence.js";
import { scheduledRunTitle } from "../src/modules/schedules/schedule-text.js";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : undefined;
}

type Api = <T = unknown>(
	path: string,
	init?: { method?: string; body?: unknown },
) => Promise<T>;

/** Pairs as the host's own browser does: an operator link from `pl pair --operator`. */
async function connect(url: string): Promise<Api> {
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
		body: JSON.stringify({ token, name: "PR checks fixture" }),
	});
	const cookie = redeemed.headers
		.getSetCookie()
		.find((c) => c.startsWith("prismalens.device."))
		?.split(";")[0];
	if (!redeemed.ok || !cookie)
		throw new Error(
			`Pairing failed: ${redeemed.status} ${await redeemed.text()}`,
		);
	return async <T>(
		path: string,
		init: { method?: string; body?: unknown } = {},
	) => {
		const res = await fetch(`${url}/api${path}`, {
			method: init.method ?? "GET",
			headers: { "content-type": "application/json", origin: url, cookie },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});
		const text = await res.text();
		if (!res.ok)
			throw new Error(
				`${init.method ?? "GET"} ${path}: ${res.status} ${text.slice(0, 300)}`,
			);
		return (text ? JSON.parse(text) : undefined) as T;
	};
}

const QUERY_TS = Array.from({ length: 40 }, (_, i) =>
	i === 30
		? "\tconst rows = await db.order.findMany({ where: { customerId } });"
		: `// orders query line ${i + 1}`,
).join("\n");
const SCHEMA = Array.from({ length: 95 }, (_, i) =>
	i === 87 ? "  @@index([customerId, createdAt])" : `// schema line ${i + 1}`,
).join("\n");

/** A project in the server's workspace and a thread on it, in its own worktree. */
async function projectThread(api: Api, workspace: string): Promise<string> {
	const source = join(workspace, `pr-checks-shop-${Date.now()}`);
	const files: Record<string, string> = {
		"README.md": "# shop\n",
		"packages/api/src/orders/query.ts": `${QUERY_TS}\n`,
		"packages/api/prisma/schema.prisma": `${SCHEMA}\n`,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(source, path)), { recursive: true });
		writeFileSync(join(source, path), text);
	}
	const git = (...a: string[]) =>
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
	// Line endings as written: a Windows autocrlf checkout would show every line as changed.
	git("config", "core.autocrlf", "false");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	const project = await api<{ id: string }>("/repositories/source", {
		method: "POST",
		body: { source },
	});
	const { investigationId: id } = await api<{ investigationId: string }>(
		"/threads",
		{
			method: "POST",
			body: {
				subject: { kind: "project", repositoryId: project.id },
				text: "Fix the slow orders query: the list endpoint got slow after the last migration.",
			},
		},
	);
	for (let i = 0; i < 120; i++) {
		const run = await api<{ status: string; workspace?: { cwd?: string } }>(
			`/investigations/${id}`,
		);
		if (!["pending", "running", "queued"].includes(run.status)) {
			const cwd = run.workspace?.cwd;
			if (!cwd) throw new Error("The thread has no worktree");
			// The change the PR carries, so the review thread's file is in the diff.
			const file = join(cwd, "packages/api/src/orders/query.ts");
			writeFileSync(
				file,
				readFileSync(file, "utf8").replace(
					"findMany({ where: { customerId } })",
					'findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })',
				),
			);
			await prisma.investigation.update({
				where: { id },
				data: { triggerReason: MARK, title: "Fix the slow orders query" },
			});
			return id;
		}
		await sleep(500);
	}
	throw new Error("Timed out waiting for the thread's first turn");
}

async function prThread(api: Api, workspace: string): Promise<string> {
	const id = await projectThread(api, workspace);
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
	const last = await prisma.investigationEvent.aggregate({
		where: { investigationId: id, branchId: "__links__" },
		_max: { seq: true },
	});
	const at = (last._max.seq ?? 0) + 1;
	const events = [
		{
			kind: "pull_request_linked",
			...base(at, id, "__links__"),
			prId: pr.id,
			url: PR_URL,
			source: "agent",
		},
		{
			kind: "pr_status",
			...base(at + 1, id, "__links__"),
			prId: pr.id,
			pr: "acme/shop#412",
			lines: ['Review: @dana requested changes: "Keep the index name stable"'],
			marks: [{ kind: "review", state: "changes_requested", name: "dana" }],
			phase: "noted",
			tone: "attention",
			checks: { state: "pending", total: 9, failed: 0, pending: 2 },
		},
		{
			kind: "pr_status",
			...base(at + 2, id, "__links__"),
			prId: pr.id,
			pr: "acme/shop#412",
			lines: ["CI failed: unit tests on 9f3c2ab"],
			marks: [
				{ kind: "check", state: "failing", sha: "9f3c2ab", name: "unit tests" },
			],
			phase: "noted",
			tone: "failing",
			checks: { state: "failing", total: 9, failed: 1, pending: 1 },
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
		/** A failed run's cause, in words. */
		error?: string;
	}>,
): Promise<string> {
	const recurrence = {
		type: "cron" as const,
		expr: cron,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	};
	const s = await prisma.schedule.create({
		data: {
			name,
			kind: "service_check",
			brief: `${name} ${BRIEF_END}`,
			recurrence: JSON.stringify(recurrence),
			harness: "claude-code",
			report: false,
			bindingsHash: NONE_HASH,
			nextRunAt: firstSlotAtOrAfter(recurrence, new Date()),
		},
	});
	for (const r of runs) {
		const at = minutes(-r.hoursAgo * 60);
		const run = await prisma.investigation.create({
			data: {
				kind: "chat",
				title: scheduledRunTitle(name, at, new Date(), recurrence.timezone),
				status: r.status,
				summary: r.summary ?? null,
				error: r.limited ? "Usage limit reached" : (r.error ?? null),
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
		// What the run said, so its thread and every card about it carry an answer or a cause.
		const said = [
			{
				kind: "agent_step",
				...base(1, run.id),
				ts: minutes(-r.hoursAgo * 60 + 3).toISOString(),
				text: r.summary ?? r.error ?? "Reading checkout's errors and deploys.",
				toolCalls: [],
			},
			...(r.limited
				? [
						{
							kind: "usage_limit",
							...base(2, run.id),
							ts: minutes(-r.hoursAgo * 60 + 4).toISOString(),
							agent: "claude-code",
							text: "Usage limit reached",
							resetsAt: minutes(150).toISOString(),
						},
					]
				: []),
		];
		await prisma.investigationEvent.createMany({
			data: said.map((e) => ({
				investigationId: run.id,
				seq: e.seq,
				branchId: e.branchId,
				event: JSON.stringify(e),
			})),
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
	const url = (arg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const workspace = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!workspace)
		throw new Error("Set PRISMALENS_WORKSPACE_DIR to the server's workspace.");
	await clear();
	const thread = await prThread(await connect(url), workspace);
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
		{
			hoursAgo: 24,
			status: "failed",
			error:
				"checkout-api answered 502 on every health probe, so the check stopped before reading its logs",
		},
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
