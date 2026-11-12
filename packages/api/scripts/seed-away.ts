#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// "Back after hours" for #1101 categories 3 and 4, on a fake clock: the operator read
// each thread up to 21:00 and left; overnight threads finished, failed, hit a limit,
// got blocked, asked and were started by a trigger. The next visible tab opens the away view.
//   PRISMALENS_WORKSPACE_DIR=<dir> pnpm --filter @prismalens/api seed:away
// Set AWAY_HOURS to change the length of the night (default 9).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PendingAsk } from "@prismalens/contracts";
import { runMigrations } from "@prismalens/database/migrator";

const MIN = 60_000;
const HOURS = Number(process.env.AWAY_HOURS ?? 9);

type Outcome =
	| "finished"
	| "failed"
	| "limited"
	| "blocked"
	| "approval"
	| "question";

interface Spec {
	key: string;
	title: string;
	parent?: string;
	outcome: Outcome;
	/** Hours into the night the outcome landed. */
	at: number;
	/** What the agent said before the operator left, then overnight. */
	before: string;
	night: string[];
	incident?: { severity: string; cause: string; command: string };
	trigger?: "scheduled" | "alert_threshold";
	command?: string;
}

const SPECS: Spec[] = [
	{
		key: "I",
		title: "Checkout 502s after deploy",
		outcome: "finished",
		at: 3.5,
		before:
			"I'm splitting the work: one thread bisects the deploy, one checks the pods.",
		night: [
			"The bisect points at v2.14.1: the connection pool size dropped from 50 to 5.",
			"Rolling back the pool setting is the fastest fix; the report has the command.",
		],
		incident: {
			severity: "high",
			cause: "v2.14.1 cut the checkout DB pool from 50 to 5 connections.",
			command: "kubectl set env deploy/checkout -n prod DB_POOL_SIZE=50",
		},
		trigger: "alert_threshold",
	},
	{
		key: "I1",
		parent: "I",
		title: "Bisect the deploy",
		outcome: "finished",
		at: 2.5,
		before: "Testing commit 1 of 9 between v2.13.0 and v2.14.1.",
		night: [
			"Commit 6 of 9 reproduces the 502s.",
			"Found it: 3f2a1c9 changes DB_POOL_SIZE from 50 to 5.",
		],
	},
	{
		key: "I2",
		parent: "I",
		title: "Restart the checkout pods",
		outcome: "approval",
		at: 4,
		before: "Reading the pod logs for stuck connections.",
		night: [
			"A rolling restart clears the stuck connections. I need your go-ahead.",
		],
		command: "kubectl rollout restart deploy/checkout -n prod",
	},
	{
		key: "U1",
		title: "Refactor the retry helper",
		outcome: "finished",
		at: 1,
		before: "Starting with the call sites in billing and payments.",
		night: [
			"Moved 14 call sites to the new helper.",
			"Done: retries now back off with jitter, and all 212 tests pass.",
		],
	},
	{
		key: "U2",
		title: "Upgrade the payment SDK",
		outcome: "limited",
		at: 5,
		before: "Reading the SDK changelog from 4.2 to 5.0.",
		night: ["Updated 9 of 17 files to the 5.0 client."],
	},
	{
		key: "U3",
		title: "Nightly flaky test triage",
		outcome: "blocked",
		at: 6,
		before: "Collecting the last 30 runs of the e2e suite.",
		night: ["Three tests fail together on slow runners."],
	},
	{
		key: "U4",
		title: "Migrate the cron jobs",
		outcome: "failed",
		at: 7,
		before: "Listing the cron jobs on the old scheduler.",
		night: [
			"The new scheduler refused the 03:00 job: its timezone is missing.",
		],
	},
	{
		key: "U5",
		title: "Pick the canary region",
		outcome: "question",
		at: 7.5,
		before: "Comparing traffic across regions.",
		night: ["Which region should take the canary first?"],
	},
	{
		key: "S",
		title: "Nightly dependency audit",
		outcome: "finished",
		at: 2,
		before: "",
		night: [
			"Audited 418 packages.",
			"Two advisories: both in dev tooling, none in the shipped bundle.",
		],
		trigger: "scheduled",
	},
];

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
	if (s.outcome === "approval")
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
	const prompt = s.night.at(-1) ?? s.title;
	return {
		...base,
		kind: "question",
		title: prompt,
		questions: [
			{
				id: "q1",
				prompt,
				multiSelect: false,
				allowOther: false,
				options: [
					{ id: "a", label: "eu-west-1" },
					{ id: "b", label: "us-east-2" },
					{ id: "c", label: "ap-south-1" },
				],
			},
		],
	};
}

const KIND: Record<Outcome, string> = {
	finished: "finished",
	failed: "failed",
	limited: "limited",
	blocked: "blocked",
	approval: "needs_you",
	question: "needs_you",
};
const STATUS: Record<Outcome, string> = {
	finished: "done",
	failed: "failed",
	limited: "limited",
	blocked: "blocked",
	approval: "approval",
	question: "question",
};

async function main(): Promise<void> {
	const dir = process.env.PRISMALENS_WORKSPACE_DIR;
	if (!dir)
		throw new Error(
			"Set PRISMALENS_WORKSPACE_DIR to the dev workspace to seed.",
		);
	await runMigrations({ databaseFile: join(dir, "prismalens.db") });
	const { prisma } = await import("@prismalens/database");
	const now = Date.now();
	const left = new Date(now - HOURS * 60 * MIN);
	const night = (h: number) => new Date(left.getTime() + h * 60 * MIN);
	const ids = new Map(SPECS.map((s) => [s.key, randomUUID()]));
	const id = (k: string) => ids.get(k) as string;
	for (const s of [...SPECS].sort(
		(a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0),
	)) {
		const end = night(s.at);
		const status =
			s.outcome === "finished" ||
			s.outcome === "approval" ||
			s.outcome === "question"
				? "completed"
				: "failed";
		let incidentId: string | null = null;
		if (s.incident) {
			const top = await prisma.incident.aggregate({ _max: { number: true } });
			incidentId = (
				await prisma.incident.create({
					data: {
						number: (top._max.number ?? 0) + 1,
						title: s.title,
						severity: s.incident.severity,
						status: "investigating",
						triggeredAt: new Date(left.getTime() - 30 * MIN),
					},
				})
			).id;
		}
		const report = s.incident
			? JSON.stringify({
					summary: s.night.at(-1),
					rootCause: s.incident.cause,
					rootCauseCategory: null,
					hypotheses: [],
					ruledOut: [],
					coverage: { queried: [], notQueried: [] },
					nextSteps: [
						{
							title: "Restore the pool size",
							detail:
								"Sets the pool back to 50; the pods pick it up on restart.",
							kind: "stop-impact",
							command: s.incident.command,
						},
					],
				})
			: null;
		const inTree = !!s.parent || SPECS.some((c) => c.parent === s.key);
		const started =
			s.trigger === "scheduled"
				? night(s.at - 0.5)
				: new Date(left.getTime() - 40 * MIN);
		await prisma.investigation.create({
			data: {
				id: id(s.key),
				kind: incidentId ? "investigation" : "chat",
				...(incidentId
					? { incidentId, rootCause: s.incident?.cause, report }
					: {}),
				status,
				title: s.title,
				titleSetBy: "agent",
				harness: "claude-code",
				accessLevel: "supervised",
				triggerType: s.trigger ?? "manual",
				...(status === "completed" ? { lastTurnOutcome: "answered" } : {}),
				...(s.outcome === "limited"
					? { endReason: "limited", limitResetsAt: new Date(now + 47 * MIN) }
					: {}),
				...(s.outcome === "blocked" ? { endReason: "blocked" } : {}),
				...(s.outcome === "failed" ? { error: s.night.at(-1) } : {}),
				...(s.outcome === "approval" ? { awaitingApprovalAt: null } : {}),
				...(inTree
					? {
							rootId: id(s.parent ?? s.key),
							parentId: s.parent ? id(s.parent) : null,
							role: s.parent ? "explorer" : null,
							depth: s.parent ? 1 : 0,
						}
					: {}),
				startedAt: started,
				completedAt: end,
				lastActivityAt: end,
				lastVisitedAt: s.trigger === "scheduled" ? null : left,
				createdAt: started,
				updatedAt: end,
			},
		});
		const runId = randomUUID();
		const base = { runId, branchId: "main", path: [] as string[] };
		const rows: Array<{ at: Date; event: Record<string, unknown> }> = [];
		if (s.trigger !== "scheduled") {
			rows.push({
				at: started,
				event: {
					kind: "operator_message",
					text: s.title,
					mode: "queue",
					delivered: true,
				},
			});
			rows.push({
				at: new Date(left.getTime() - 5 * MIN),
				event: { kind: "agent_step", text: s.before, toolCalls: [] },
			});
		}
		s.night.forEach((text, i) => {
			const share = (i + 1) / s.night.length;
			rows.push({
				at: night(s.at * share),
				event: { kind: "agent_step", text, toolCalls: [] },
			});
		});
		// One by one: the commit ordinal is stamped per row, and reads compare ordinals.
		for (const [seq, r] of rows.entries())
			await prisma.investigationEvent.create({
				data: {
					investigationId: id(s.key),
					seq,
					branchId: "main",
					createdAt: r.at,
					event: JSON.stringify({
						...r.event,
						...base,
						seq,
						ts: r.at.toISOString(),
					}),
				},
			});
		const thread = await prisma.investigation.findUniqueOrThrow({
			where: { id: id(s.key) },
			select: { eventOrdinal: true, eventGeneration: true },
		});
		// Read up to what the agent said before 21:00; the night's events are unseen.
		if (s.trigger !== "scheduled") {
			const seen = await prisma.investigationEvent.findFirstOrThrow({
				where: { investigationId: id(s.key), seq: 1 },
				select: { ordinal: true },
			});
			await prisma.threadRead.create({
				data: {
					investigationId: id(s.key),
					generation: thread.eventGeneration,
					ordinal: seen.ordinal,
					readAt: left,
				},
			});
		}
		if (s.outcome === "approval" || s.outcome === "question") {
			const ask = askOf(id(s.key), s, end);
			await prisma.toolAsk.create({
				data: {
					askId: ask.askId,
					threadId: ask.threadId,
					ask: JSON.stringify(ask),
					status: "open",
					openedAt: end,
				},
			});
		}
		if (s.outcome === "limited" || s.outcome === "blocked")
			await prisma.threadWake.create({
				data: {
					investigationId: id(s.key),
					kind: "limit",
					at: new Date(now + 47 * MIN),
					reason: s.night.at(-1) ?? s.title,
					state: s.outcome === "blocked" ? "skipped" : "pending",
					payload: JSON.stringify(
						s.outcome === "blocked"
							? { mode: "key_rejected", blocked: true }
							: { mode: "usage_limit" },
					),
				},
			});
		await prisma.threadAttention.create({
			data: { investigationId: id(s.key), lastStatus: STATUS[s.outcome] },
		});
		const child = !!s.parent;
		const triggered = !!s.trigger;
		const events: Array<{ kind: string; at: Date; detail: string | null }> = [];
		if (s.trigger === "scheduled")
			events.push({ kind: "started", at: started, detail: "scheduled" });
		events.push({
			kind: KIND[s.outcome],
			at: end,
			detail:
				s.outcome === "approval"
					? `Run ${s.command?.split(" ")[0]}`
					: s.outcome === "question"
						? (s.night.at(-1) ?? null)
						: s.outcome === "limited"
							? "usage_limit"
							: s.outcome === "blocked"
								? "key_rejected"
								: null,
		});
		for (const e of events)
			await prisma.attentionEvent.create({
				data: {
					investigationId: id(s.key),
					kind: e.kind,
					status: STATUS[s.outcome],
					detail: e.detail,
					resetsAt: s.outcome === "limited" ? new Date(now + 47 * MIN) : null,
					ordinal: thread.eventOrdinal,
					generation: thread.eventGeneration,
					notify:
						e.kind === "finished"
							? !child && !triggered
							: e.kind === "failed"
								? !child
								: e.kind !== "started",
					createdAt: e.at,
				},
			});
	}
	// The last visible tab was at 21:00: the next one starts a long away.
	await prisma.setting.upsert({
		where: { key: "attention.activity" },
		create: {
			key: "attention.activity",
			value: JSON.stringify({
				lastActiveAt: left.toISOString(),
				awaySince: null,
				gapMs: 0,
			}),
			type: "json",
			category: "notifications",
		},
		update: {
			value: JSON.stringify({
				lastActiveAt: left.toISOString(),
				awaySince: null,
				gapMs: 0,
			}),
		},
	});
	console.log(
		`seed:away: ${SPECS.length} threads changed over a ${HOURS} h night since ${left.toLocaleTimeString()}`,
	);
	await prisma.$disconnect();
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
