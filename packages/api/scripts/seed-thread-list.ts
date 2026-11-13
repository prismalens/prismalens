#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Dev fixture for #1101 categories 1, 2, 8, 19 and 20: 40 flat threads, 12 of them started
// by 3 starters, in every status (Approval needed, Question, Blocked, Failed, Limited,
// Working, Waiting, Done), asks waiting in several threads, an incident, pinned and settled.
//   PRISMALENS_WORKSPACE_DIR=<dir> pnpm --filter @prismalens/api seed:thread-list
// Run it while the server is up: a boot treats a seeded running run as cut off by a restart.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PendingAsk } from "@prismalens/contracts";
import { runMigrations } from "@prismalens/database/migrator";
import { clearSeed, seedId } from "./seed-ids.js";

const MIN = 60_000;

interface Spec {
	key: string;
	title: string;
	/** Grouping kept from the fixture's story; only STARTERS turn it into a start link. */
	parent?: string;
	status?: "completed" | "running" | "failed";
	/** Minutes since its last event. */
	ago: number;
	say: string;
	ask?: "permission" | "question";
	command?: string;
	prWatch?: {
		number: number;
		tone: "failing" | "draft" | "ready" | "attention";
	};
	cron?: string;
	wakeIn?: number;
	limit?: "usage_limit" | "key_rejected";
	paused?: boolean;
	seen?: boolean;
	settled?: boolean;
	pinned?: boolean;
	/** An alert-started incident thread: its row shows severity and likely cause. */
	incident?: boolean;
}

const SPECS: Spec[] = [
	{
		key: "A",
		title: "Checkout 502s after deploy",
		ago: 3,
		say: "I split the work across four threads; two are still running.",
		seen: true,
	},
	{
		key: "A1",
		parent: "A",
		title: "Restart the checkout pods",
		ago: 4,
		say: "The pool config is fine; a rolling restart clears the stuck connections.",
		ask: "permission",
		command: "kubectl rollout restart deploy/checkout -n prod",
	},
	{
		key: "A2",
		parent: "A",
		title: "Bisect the deploy",
		status: "running",
		ago: 0,
		say: "Testing commit 4 of 9 between v2.13.0 and v2.14.1.",
	},
	{
		key: "A3",
		parent: "A",
		title: "Check replica lag",
		status: "running",
		ago: 14,
		say: "Waiting on the replica metrics query.",
	},
	{
		key: "A4",
		parent: "A",
		title: "Draft the rollback PR",
		ago: 6,
		say: "Opened PR #331; watching its checks before I hand it back.",
		prWatch: { number: 331, tone: "failing" },
	},
	{
		key: "A5",
		parent: "A",
		title: "Summarise the timeline",
		ago: 9,
		say: "The timeline is in the report: deploy at 13:58, errors from 14:01.",
	},
	{
		key: "A6",
		parent: "A2",
		title: "Read the connection pool code",
		ago: 7,
		say: "maxIdle dropped from 50 to 5 in v2.14.0.",
		seen: true,
	},
	{
		key: "A7",
		parent: "A2",
		title: "Which commit changed maxIdle?",
		ago: 2,
		say: "Two commits touch the pool; which should I test first?",
		ask: "question",
	},
	{
		key: "A8",
		parent: "A",
		title: "Collect error samples",
		ago: 30,
		say: "Saved 40 sample traces to the report.",
		seen: true,
	},
	{
		key: "A9",
		parent: "A",
		title: "Ping the on-call channel",
		ago: 25,
		say: "Posted the status update.",
		seen: true,
	},
	{
		key: "B",
		title: "Flaky test in payments",
		ago: 8,
		say: "Three threads chase the flake from different sides.",
		pinned: true,
		seen: true,
	},
	{
		key: "B1",
		parent: "B",
		title: "Run the suite 50 times",
		ago: 5,
		say: "Should I run it with the race detector on?",
		ask: "question",
	},
	{
		key: "B2",
		parent: "B",
		title: "Rerun under load",
		status: "failed",
		ago: 11,
		say: "The load generator exited with code 137.",
	},
	{
		key: "B3",
		parent: "B",
		title: "Read the test history",
		ago: 40,
		say: "It fails 1 run in 14, always on the refund path.",
		seen: true,
	},
	{
		key: "B4",
		parent: "B",
		title: "Watch the nightly run",
		ago: 16,
		say: "I check the nightly run every 30 minutes.",
		cron: "*/30 * * * *",
		seen: true,
	},
	{
		key: "B5",
		parent: "B",
		title: "Retry after the cache warms",
		ago: 12,
		say: "I'll look again once the cache has warmed.",
		wakeIn: 35,
		seen: true,
	},
	{
		key: "B6",
		parent: "B1",
		title: "Delete the stale fixtures",
		ago: 3,
		say: "These fixtures are unused since March.",
		ask: "permission",
		command: "rm -rf services/payments/test/fixtures/legacy",
	},
	{
		key: "C",
		title: "Nightly dependency upgrade",
		ago: 20,
		say: "Hit the usage limit halfway through the lockfile.",
		limit: "usage_limit",
	},
	{
		key: "C1",
		parent: "C",
		title: "Upgrade the API client",
		ago: 22,
		say: "The provider rejected the API key.",
		limit: "key_rejected",
	},
	{
		key: "C2",
		parent: "C",
		title: "Run the type checks",
		status: "running",
		ago: 1,
		say: "Type checking 412 files.",
	},
	{
		key: "C3",
		parent: "C",
		title: "List breaking changes",
		ago: 50,
		say: "Two breaking changes: the retry option and the logger.",
		seen: true,
	},
	{
		key: "D",
		title: "Investigate latency regression",
		ago: 33,
		say: "Automatic updates paused after 12 turns today.",
		paused: true,
	},
	{
		key: "E",
		title: "Release notes draft",
		ago: 18,
		say: "Draft PR is up; I wake at the release cut to finish it.",
		prWatch: { number: 418, tone: "draft" },
		wakeIn: 90,
		seen: true,
	},
	{
		key: "E1",
		parent: "E",
		title: "Collect merged PRs",
		ago: 19,
		say: "Found 23 merged PRs since v2.13.",
		seen: true,
	},
	{
		key: "E2",
		parent: "E",
		title: "Write the upgrade notes",
		status: "running",
		ago: 0,
		say: "Writing the section on the new retry option.",
	},
	{
		key: "F",
		title: "Docs cleanup",
		ago: 45,
		say: "Removed 12 dead links and fixed two code samples.",
	},
	{
		key: "G",
		title: "Rotate the staging secrets",
		ago: 2,
		say: "Rotating requires writing the new key to the vault.",
		ask: "permission",
		command: "vault kv put secret/staging/api key=@new-key.txt",
	},
	{
		key: "H",
		title: "Why is the build cache cold?",
		status: "running",
		ago: 0,
		say: "Comparing cache keys between two runs.",
	},
	{
		key: "I",
		title: "Tidy the Grafana dashboards",
		ago: 70,
		say: "Merged four duplicate panels.",
		seen: true,
	},
	{
		key: "J",
		title: "Profile the search endpoint",
		status: "failed",
		ago: 26,
		say: "The profiler could not attach to the process.",
		seen: true,
	},
	{
		key: "K",
		title: "Plan the Postgres upgrade",
		ago: 95,
		say: "The plan is in the thread: three steps, one maintenance window.",
		seen: true,
	},
	{
		key: "K1",
		parent: "K",
		title: "Check extension support",
		ago: 96,
		say: "All six extensions support 17.",
		seen: true,
	},
	{
		key: "S",
		title: "Checkout API 5xx spike",
		ago: 10,
		say: "The pool limit change in v2.14.0 is the likely cause.",
		incident: true,
	},
	{
		key: "L",
		title: "Old: migrate cron jobs",
		ago: 4000,
		say: "Moved all jobs.",
		settled: true,
		seen: true,
	},
	{
		key: "M",
		title: "Old: audit IAM roles",
		ago: 5000,
		say: "Removed 9 unused roles.",
		settled: true,
		seen: true,
	},
	{
		key: "N",
		title: "Old: fix the logo on dark mode",
		ago: 6000,
		say: "Done.",
		settled: true,
		seen: true,
	},
	{
		key: "O",
		title: "Old: bump Node to 24",
		ago: 7000,
		say: "Bumped in all images.",
		settled: true,
		seen: true,
	},
	{
		key: "P",
		title: "Old: archive the v1 API docs",
		ago: 8000,
		say: "Archived.",
		settled: true,
		seen: true,
	},
	{
		key: "Q",
		title: "Old: speed up the e2e suite",
		ago: 9000,
		say: "From 14 to 9 minutes.",
		settled: true,
		seen: true,
	},
	{
		key: "R",
		title: "Old: write the on-call runbook",
		ago: 9500,
		say: "Runbook published.",
		settled: true,
		seen: true,
	},
];

const SEED_SHA = "4b1d9e0c7a2f3e5d6c8b9a0f1e2d3c4b5a697887";
const CHECK_NAMES = ["build", "unit tests", "lint", "typecheck", "e2e", "docs"];

/** Named check runs, so the PR view lists each check instead of a bare count. */
function prDetail(number: number, tone: NonNullable<Spec["prWatch"]>["tone"]) {
	const stateOf = (i: number) =>
		tone === "failing" && i < 2
			? "failing"
			: tone === "attention" && i === 4
				? "pending"
				: "passing";
	return {
		author: { login: "prismalens-agent" },
		reviewers: [],
		headRef: `pl/pr-${number}`,
		baseRef: "main",
		mergeState: tone === "failing" ? "blocked" : "clean",
		checkRuns: CHECK_NAMES.map((name, i) => ({
			name,
			state: stateOf(i),
			appName: "GitHub Actions",
			id: `${number}${i}`,
			appId: "15368",
			headSha: SEED_SHA,
			url: `https://github.com/acme/checkout/actions/runs/${number}/job/${i}`,
		})),
		checkLogs: [],
		reviewThreads: [],
	};
}

function askOf(threadId: string, s: Spec, at: Date): PendingAsk {
	const base = {
		askId: randomUUID(),
		threadId,
		requiresHost: true,
		source: {
			kind: "tool" as const,
			tool: "run_command",
			requestId: randomUUID(),
		},
		openedAt: at.toISOString(),
	};
	if (s.ask === "permission")
		return {
			...base,
			kind: "permission",
			title: `Run ${s.command?.split(" ")[0] ?? "a command"}`,
			permission: {
				toolKind: "execute",
				command: s.command,
				pattern: `${s.command?.split(" ").slice(0, 2).join(" ")} *`,
				identity: randomUUID(),
				options: [
					{ optionId: "allow", name: "Allow once", kind: "allow_once" },
					{ optionId: "always", name: "Always", kind: "allow_always" },
					{ optionId: "reject", name: "Deny", kind: "reject_once" },
				],
			},
		};
	// A question is PrismaLens's own `pl_ask_user`: its answer reaches the agent and
	// resumes the thread. The server hears it once it has started after this seed.
	const askId = randomUUID();
	return {
		...base,
		askId,
		requiresHost: false,
		source: { kind: "tool", tool: "pl_ask_user", requestId: askId },
		kind: "question",
		title: s.say,
		questions: [
			{
				id: "q1",
				prompt: s.say,
				multiSelect: false,
				allowOther: false,
				options: [
					{ id: "a", label: "The first one" },
					{ id: "b", label: "The second one" },
					{ id: "c", label: "Both, in order" },
				],
			},
		],
	};
}

/** The record's `ask_opened`, as AsksService commits it beside the row. */
function askOpened(ask: PendingAsk, seq: number, at: Date) {
	return {
		investigationId: ask.threadId,
		seq,
		branchId: "asks",
		createdAt: at,
		event: JSON.stringify({
			kind: "ask_opened",
			ask,
			runId: ask.threadId,
			branchId: "asks",
			path: [],
			seq,
			label: null,
			ts: at.toISOString(),
		}),
	};
}

async function main(): Promise<void> {
	const dir = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!dir)
		throw new Error(
			"Set PRISMALENS_WORKSPACE_DIR to the dev workspace to seed.",
		);
	await runMigrations({ databaseFile: join(dir, "prismalens.db") });
	const { prisma } = await import("@prismalens/database");
	const now = Date.now();
	const ids = new Map(SPECS.map((s) => [s.key, seedId("thread-list", s.key)]));
	const id = (k: string) => ids.get(k) as string;
	const incidentOf = (k: string) => seedId("thread-list", `incident:${k}`);
	await clearSeed(
		prisma,
		[...ids.values()],
		SPECS.filter((s) => s.incident).map((s) => incidentOf(s.key)),
	);
	// 12 of the 40 were started by an agent: 5 by A, 4 by B and 3 by C (#1101 cat 1 item 1).
	const STARTERS: Record<string, number> = { A: 5, B: 4, C: 3 };
	const startedBy = new Map(
		Object.entries(STARTERS).flatMap(([key, n]) =>
			SPECS.filter((s) => s.parent === key)
				.slice(0, n)
				.map((s) => [s.key, key] as const),
		),
	);
	// Starters first, so every parentId already exists.
	// The seeded threads take turns among the supported agents, so each row shows its own mark.
	const AGENTS = ["claude-code", "codex", "opencode", "gemini"] as const;
	for (const s of [...SPECS].sort(
		(a, b) => Number(startedBy.has(a.key)) - Number(startedBy.has(b.key)),
	)) {
		const at = new Date(now - s.ago * MIN);
		const status = s.status ?? (s.limit ? "failed" : "completed");
		const by = startedBy.get(s.key);
		let incidentId: string | null = null;
		if (s.incident) {
			const top = await prisma.incident.aggregate({ _max: { number: true } });
			const inc = await prisma.incident.create({
				data: {
					id: incidentOf(s.key),
					number: (top._max.number ?? 0) + 1,
					title: s.title,
					severity: "high",
					status: "investigating",
					triggeredAt: at,
				},
			});
			incidentId = inc.id;
		}
		await prisma.investigation.create({
			data: {
				id: id(s.key),
				kind: incidentId ? "investigation" : "chat",
				...(incidentId ? { incidentId, rootCause: s.say } : {}),
				status,
				title: s.title,
				titleSetBy: "agent",
				harness: AGENTS[SPECS.indexOf(s) % AGENTS.length],
				accessLevel: "supervised",
				triggerType: incidentId ? "alert_threshold" : "manual",
				...(status === "completed" ? { lastTurnOutcome: "answered" } : {}),
				// The composer's context meter reads used / size; spread so some rows near compaction.
				usage: JSON.stringify({
					used: 12_000 + ((SPECS.indexOf(s) * 37_000) % 170_000),
					size: 200_000,
					at: at.toISOString(),
				}),
				...(s.limit
					? {
							endReason: s.limit === "key_rejected" ? "blocked" : "limited",
							error: s.say,
						}
					: {}),
				...(status === "failed" && !s.limit ? { error: s.say } : {}),
				...(s.limit === "usage_limit"
					? { limitResetsAt: new Date(now + 47 * MIN) }
					: {}),
				...(s.paused
					? {
							autoPause: JSON.stringify({
								reason: "ceiling",
								since: at.toISOString(),
							}),
						}
					: {}),
				...(by ? { parentId: id(by), rootId: id(by), depth: 1 } : {}),
				startedAt: new Date(at.getTime() - 20 * MIN),
				...(status !== "running" ? { completedAt: at } : {}),
				lastActivityAt: at,
				...(s.seen ? { lastVisitedAt: new Date(at.getTime() + MIN) } : {}),
				...(s.settled ? { settledAt: new Date(at.getTime() + MIN) } : {}),
				...(s.pinned ? { pinnedAt: new Date(now) } : {}),
				createdAt: new Date(at.getTime() - 30 * MIN),
			},
		});
		const runId = randomUUID();
		const base = { runId, branchId: "main", path: [] as string[] };
		await prisma.investigationEvent.createMany({
			data: [
				{
					kind: "operator_message",
					text: s.title,
					mode: "queue",
					delivered: true,
				},
				{ kind: "agent_step", text: s.say, toolCalls: [] },
			].map((e, seq) => ({
				investigationId: id(s.key),
				seq,
				branchId: "main",
				createdAt: at,
				event: JSON.stringify({ ...e, ...base, seq, ts: at.toISOString() }),
			})),
		});
		if (s.ask) {
			const ask = askOf(id(s.key), s, at);
			await prisma.toolAsk.create({
				data: {
					askId: ask.askId,
					threadId: ask.threadId,
					ask: JSON.stringify(ask),
					status: "open",
					openedAt: at,
				},
			});
			await prisma.investigationEvent.create({
				data: askOpened(ask, 2, at),
			});
		}
		if (s.prWatch) {
			const prId = randomUUID();
			const tone = s.prWatch.tone;
			await prisma.pullRequest.create({
				data: {
					id: prId,
					investigationId: id(s.key),
					host: "github",
					repo: "acme/checkout",
					url: `https://github.com/acme/checkout/pull/${s.prWatch.number}`,
					number: s.prWatch.number,
					title: s.title,
					state: tone === "draft" ? "draft" : "open",
					review: tone === "ready" ? "approved" : "review_required",
					checks: JSON.stringify({
						state:
							tone === "failing"
								? "failing"
								: tone === "attention"
									? "pending"
									: "passing",
						total: 6,
						failed: tone === "failing" ? 2 : 0,
						pending: tone === "attention" ? 1 : 0,
					}),
					conflicts: false,
					source: "agent",
					headSha: SEED_SHA,
					fetchedAt: new Date(now),
					detail: JSON.stringify(prDetail(s.prWatch.number, tone)),
				},
			});
			if (tone !== "draft")
				await prisma.prWatch.create({
					data: {
						prId,
						investigationId: id(s.key),
						until: "checks_done",
						expiresAt: new Date(now + 24 * 60 * MIN),
					},
				});
		}
		if (s.cron)
			await prisma.cronJob.create({
				data: {
					investigationId: id(s.key),
					name: "Check the nightly run",
					schedule: s.cron,
					prompt: "Check the nightly run.",
					nextAt: new Date(now + 14 * MIN),
				},
			});
		if (s.wakeIn)
			await prisma.threadWake.create({
				data: {
					investigationId: id(s.key),
					kind: "agent",
					at: new Date(now + s.wakeIn * MIN),
					reason: "Look again",
				},
			});
		if (s.limit)
			await prisma.threadWake.create({
				data: {
					investigationId: id(s.key),
					kind: "limit",
					at: new Date(now + 47 * MIN),
					reason: s.say,
					state: s.limit === "key_rejected" ? "skipped" : "pending",
					payload: JSON.stringify(
						s.limit === "key_rejected"
							? { mode: "key_rejected", blocked: true }
							: { mode: "usage_limit" },
					),
				},
			});
	}
	console.log(
		`seed:thread-list: ${SPECS.length} threads, ${startedBy.size} started by agents, ${SPECS.filter((s) => s.ask).length} open asks`,
	);
	console.log(
		`seed:thread-list: restart the API so answered questions reach their threads (it hears pl_ask_user asks from its start)`,
	);
	await prisma.$disconnect();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main().catch((err) => {
		console.error("seed:thread-list failed:", err);
		process.exit(1);
	});
