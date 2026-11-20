#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// A dev fixture for #1101 categories 15 and 22 on a running PrismaLens with the fake agent on its
// PATH: a project thread in its own worktree whose PR has failing, running and passing checks, a
// kept log tail and review threads on a file the thread changed, plus schedules with run history
// and a run held by a usage limit. The PR's host data is recorded: nothing calls a git host.
// #1176 adds a head commit on the PR's branch, usage, sub-agents and the PRs #413 and #414.
//   PRISMALENS_WORKSPACE_DIR=<server's workspace> pnpm --filter @prismalens/api fixture:pr-checks --url http://127.0.0.1:3311 [--remote]
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
/** A head commit no project folder has, so a fix preview offers to fetch it (#1176 A13). */
const ABSENT_SHA = "b7e1c0d2a3f4b5c6d7e8f9a0b1c2d3e4f5a6b7c8";
const OTHER_CI_APP = "999";
const prUrl = (n: number) => `https://github.com/acme/shop/pull/${n}`;
const NONE_HASH = createHash("sha256")
	.update(JSON.stringify({ subject: "none" }))
	.digest("hex");

const minutes = (m: number) => new Date(Date.now() + m * 60_000);
let SHA = "";

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
	await prisma.incident.deleteMany({ where: { title: INCIDENT_TITLE } });
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
			headers: {
				"content-type": "application/json",
				origin: url,
				cookie,
				"sec-fetch-site": "same-origin",
			},
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
	// The PR's head: the query change committed on its branch, so a fix thread can start there.
	git("checkout", "-q", "-b", "fix/orders-index");
	writeFileSync(
		join(source, "packages/api/src/orders/query.ts"),
		`${QUERY_TS.replace(
			"findMany({ where: { customerId } })",
			'findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })',
		)}\n`,
	);
	git("commit", "-q", "-am", "Sort orders by date in the query");
	SHA = git("rev-parse", "HEAD").toString().trim();
	git("checkout", "-q", "main");
	// --remote: the PR's repository as origin, so a review reply has a remote to write to;
	// pair it with the sim's fake-code-host, or the PR watch calls the real host.
	if (process.argv.includes("--remote"))
		git("remote", "add", "origin", "https://github.com/acme/shop.git");
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

/** The PR on a project thread, and its checks, review threads and status lines. */
async function prThread(api: Api, workspace: string): Promise<string> {
	const id = await projectThread(api, workspace);
	await attachPr(id, {
		number: 412,
		title: "Restore the orders index the checkout query lost",
		headRef: "fix/orders-index",
	});
	await attachPr(id, {
		number: 413,
		title: "Cache the orders count",
		headRef: "fix/orders-cache",
		headSha: ABSENT_SHA,
	});
	await attachPr(id, {
		number: 414,
		title: "Name the branch from the shell",
		headRef: "fix/$(whoami)",
	});
	await sessionLanes(id);
	return id;
}

interface PrSpec {
	number: number;
	title: string;
	headRef: string;
	headSha?: string;
}

const actions = (
	name: string,
	state: string,
	id: string,
	group: string,
	sha: string,
	extra: Record<string, unknown> = {},
) => ({
	name,
	state,
	appName: "GitHub Actions",
	id,
	appId: "15368",
	headSha: sha,
	group,
	url: `https://github.com/acme/shop/actions/runs/${group}/job/${id}`,
	...extra,
});

/** #412's kept runs (#1176 §8.1): 4 failing of 144, one pending in the integration run's workflow. */
const checkRuns = (sha: string) => [
	actions("unit tests", "failing", "2", "1101", sha, { rerunnable: true }),
	{
		name: "unit tests",
		state: "failing",
		appName: "Other CI",
		id: "20",
		appId: OTHER_CI_APP,
		headSha: sha,
		group: "5501",
		url: "https://ci.example.com/acme/shop/builds/20",
	},
	actions("deploy preview", "failing", "21", "1103", sha, { cancelled: true }),
	actions("integration", "failing", "22", "1102", sha, { rerunnable: false }),
	actions("e2e", "pending", "3", "1102", sha),
	...["build", "lint", "typecheck", "format", "docs", "license"].map((n, i) =>
		actions(n, "passing", String(30 + i), "1101", sha, { rerunnable: true }),
	),
];

async function attachPr(id: string, spec: PrSpec): Promise<void> {
	const PR_URL = prUrl(spec.number);
	const sha = spec.headSha ?? SHA;
	const pr = await prisma.pullRequest.create({
		data: {
			investigationId: id,
			host: "github",
			repo: "acme/shop",
			url: PR_URL,
			number: spec.number,
			title: spec.title,
			state: "open",
			review: "changes_requested",
			checks: JSON.stringify({
				state: "failing",
				total: 144,
				failed: 4,
				pending: 1,
			}),
			conflicts: false,
			source: "agent",
			headSha: sha,
			fetchedAt: new Date(),
			detail: JSON.stringify({
				author: { login: "prismalens-agent" },
				reviewers: [{ login: "dana", state: "changes_requested" }],
				headRef: spec.headRef,
				baseRef: "main",
				headRepo: "acme/shop",
				mergeState: "blocked",
				checkRuns: checkRuns(sha),
				checkLogs: [
					{
						runId: "22",
						headSha: sha,
						step: null,
						lines: [],
						unavailable:
							"The git host gives logs only to a signed-in reader with access to its CI; this repository's token cannot read them.",
						fetchedAt: new Date().toISOString(),
					},
					{
						runId: "2",
						headSha: sha,
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
					{
						id: "rt3",
						path: "packages/api/src/orders/query.ts",
						line: 12,
						author: "review-bot",
						resolved: false,
						outdated: false,
						excerpt:
							'<!-- fingerprint -->`&lt;Widget&gt;` needs a stable order.\n<details><summary>Suggested fix</summary>Use orderBy createdAt</details>\n<picture><img src="https://x/y.png"></picture>',
						replies: 0,
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
			pr: `acme/shop#${spec.number}`,
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
			pr: `acme/shop#${spec.number}`,
			lines: [`CI failed: unit tests on ${sha.slice(0, 7)}`],
			marks: [
				{
					kind: "check",
					state: "failing",
					sha: sha.slice(0, 7),
					name: "unit tests",
				},
			],
			phase: "noted",
			tone: "failing",
			checks: { state: "failing", total: 144, failed: 4, pending: 1 },
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
}

/**
 * Usage, sub-agents and a lane with no session of its own, stored as ingest would store them,
 * then 300 later events so none of it is in the transcript's first page (#1176 A1, A23).
 */
async function sessionLanes(id: string): Promise<void> {
	await prisma.investigation.update({
		where: { id },
		data: {
			// Seen now, so the thread opens at its end and the lanes above sit outside the window.
			lastVisitedAt: new Date(Date.now() + 60_000),
			usage: JSON.stringify({
				used: 48000,
				size: 200000,
				at: new Date().toISOString(),
			}),
		},
	});
	const last = await prisma.investigationEvent.findFirst({
		where: { investigationId: id, NOT: { branchId: "__links__" } },
		orderBy: { seq: "desc" },
		select: { seq: true, branchId: true },
	});
	const branchId = last?.branchId ?? "main";
	let seq = last?.seq ?? 0;
	const start = Date.now() - 30 * 60_000;
	const ev = (body: Record<string, unknown>, path: string[] = []) => {
		seq += 1;
		return {
			runId: id,
			branchId,
			path,
			label: null,
			seq,
			ts: new Date(start + seq * 1000).toISOString(),
			...body,
		};
	};
	const turn = (input: number, output: number, amount: number, cur: string) =>
		ev({
			kind: "turn_usage",
			usage: {
				inputTokens: input,
				outputTokens: output,
				cost: { amount, currency: cur },
			},
		});
	const subagent = (sessionId: string, title: string, state: string) =>
		ev({
			kind: "subagent",
			sessionId,
			phase: "started",
			title,
			task: title,
			state,
		});
	const events = [
		turn(1000, 200, 0.1, "USD"),
		turn(500, 100, 0.05, "USD"),
		turn(300, 50, 1.0, "EUR"),
		subagent("s-run", "Search the logs", "running"),
		subagent("s-fail", "Read the schema", "failed"),
		subagent("s-done", "List the indexes", "completed"),
		ev({
			kind: "agent_step",
			text: "Checking readiness in a sub-agent.",
			toolCalls: [
				{
					toolCallId: "tc9",
					name: "Task",
					args: { description: "readiness check", prompt: "Check readiness" },
				},
			],
		}),
		...[1, 2, 3].map((n) =>
			ev({ kind: "agent_step", text: `Readiness step ${n}`, toolCalls: [] }, [
				"tc9",
			]),
		),
		ev({
			kind: "tool_result",
			result: {
				name: "Task",
				toolCallId: "tc9",
				source: "Task",
				ok: true,
				preview: "Ready",
			},
		}),
		...Array.from({ length: 300 }, (_, i) =>
			ev({ kind: "agent_step", text: `Reading line ${i + 1}`, toolCalls: [] }),
		),
	];
	await prisma.investigationEvent.createMany({
		data: events.map((e) => ({
			investigationId: id,
			seq: e.seq,
			branchId: e.branchId,
			event: JSON.stringify(e),
		})),
	});
	const at = (n: number) => new Date(start + n * 1000);
	const rows = [
		["s-run", "Search the logs", "running", null],
		["s-fail", "Read the schema", "failed", at(20)],
		["s-done", "List the indexes", "completed", at(30)],
		["tc9", "readiness check", "completed", at(40)],
	] as const;
	for (const [sessionId, title, state, endedAt] of rows)
		await prisma.subagentSession.create({
			data: {
				investigationId: id,
				sessionId,
				title,
				task: title,
				state,
				startedAt: at(5),
				endedAt,
			},
		});
}

const INCIDENT_TITLE = "Checkout 502s after the orders index was dropped";

/** A thread an incident started, with a confirmed cause and a PR whose checks are recorded (#1101 15.6). */
async function incidentPrThread(api: Api): Promise<string> {
	const incident = await api<{ id: string }>("/incidents", {
		method: "POST",
		body: { title: INCIDENT_TITLE, tags: ["chat"] },
	});
	const { investigationId: id } = await api<{ investigationId: string }>(
		`/incidents/${incident.id}/chat`,
		{
			method: "POST",
			body: {
				text: "Why are checkouts failing: the orders list got slow after the last migration.",
				harness: "claude-code",
			},
		},
	);
	for (let i = 0; i < 120; i++) {
		const run = await api<{ status: string }>(`/investigations/${id}`);
		if (!["pending", "running", "queued"].includes(run.status)) break;
		await sleep(500);
	}
	await prisma.investigation.update({
		where: { id },
		data: { triggerReason: MARK },
	});
	const last = await prisma.investigationEvent.aggregate({
		where: { investigationId: id, branchId: "root" },
		_max: { seq: true },
	});
	const at = new Date().toISOString();
	const seq = (last._max.seq ?? 0) + 1;
	await prisma.investigationEvent.create({
		data: {
			investigationId: id,
			seq,
			branchId: "root",
			event: JSON.stringify({
				kind: "finding_recorded",
				runId: id,
				branchId: "root",
				path: [],
				seq,
				label: null,
				ts: at,
				finding: {
					type: "hypothesis",
					id: "h1",
					statement: "the deploy dropped the orders index",
					status: "confirmed",
					evidenceIds: [],
					at,
				},
			}),
		},
	});
	await attachPr(id, {
		number: 418,
		title: "Add the orders index back with its created_at column",
		headRef: "fix/orders-index-created-at",
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
	const api = await connect(url);
	const thread = await prThread(api, workspace);
	const incidentThread = await incidentPrThread(api);
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
	console.log(`fixture: incident thread /threads/${incidentThread}`);
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
