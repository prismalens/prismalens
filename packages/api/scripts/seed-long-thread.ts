#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Dev fixture for #1101 categories 12-14: a 5,000-item thread with long tool outputs,
// a compaction, a usage limit, an API-key failure and a restart, plus a 40-thread
// tree in mixed states, into the database under PRISMALENS_WORKSPACE_DIR.
//   PRISMALENS_WORKSPACE_DIR=<dir> pnpm --filter @prismalens/api seed:long-thread
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CanonicalEvent } from "@prismalens/contracts";
import { runMigrations } from "@prismalens/database/migrator";

const ITEMS = Number(process.env.SEED_ITEMS ?? 5000);
const TREE = 40;
const DAY = 86_400_000;

function words(n: number, seed: number): string {
	const vocab =
		"the checkout service returned 502 after deploy pool exhausted connection retry latency spike cache miss rollback config flag database replica lag queue backlog worker timeout trace span alert fired pager on-call usability round state incident evidence hypothesis".split(
			" ",
		);
	const out: string[] = [];
	for (let i = 0; i < n; i++)
		out.push(vocab[(seed * 31 + i * 7) % vocab.length] as string);
	return out.join(" ");
}

function logLines(n: number, seed: number): string {
	const lines: string[] = [];
	for (let i = 0; i < n; i++)
		lines.push(
			`2026-11-12T08:${String(i % 60).padStart(2, "0")}:00Z level=${i % 9 === 0 ? "error" : "info"} svc=checkout req=${seed}-${i} msg="${words(12, seed + i)}"`,
		);
	return lines.join("\n");
}

/** The long thread's events: ~120 turns, one oversized, with the rail's marks. */
export function longThreadEvents(
	runId: string,
	start: number,
): CanonicalEvent[] {
	const events: CanonicalEvent[] = [];
	let seq = 0;
	let t = start;
	const base = { runId, branchId: "main", path: [] as string[] };
	const ts = () => {
		t += 1500;
		return new Date(t).toISOString();
	};
	let turn = 0;
	while (events.length < ITEMS) {
		turn++;
		const special = turn % 120;
		if (special === 90)
			events.push({
				kind: "operator_message",
				...base,
				seq: seq++,
				ts: ts(),
				text: "Continue where you left off.",
				mode: "queue",
				delivered: true,
				via: {
					harness: "claude-code",
					model: null,
					accessLevel: null,
					restart: {
						stoppedAt: new Date(t - 60_000).toISOString(),
						resumedAt: new Date(t).toISOString(),
						by: "auto",
					},
				},
			});
		else
			events.push({
				kind: "operator_message",
				...base,
				seq: seq++,
				ts: ts(),
				text: `Turn ${turn}: ${words(10 + (turn % 25), turn)}?`,
				mode: "queue",
				delivered: true,
			});
		// Turn 60 is one oversized turn: a page cuts inside it.
		const calls = turn === 60 ? 300 : 3 + (turn % 9);
		for (let c = 0; c < calls && events.length < ITEMS; c++) {
			const callId = `call-${turn}-${c}`;
			events.push({
				kind: "agent_step",
				...base,
				seq: seq++,
				ts: ts(),
				text: c === 0 ? `Looking at ${words(8, turn + c)}.` : "",
				toolCalls: [
					{
						toolCallId: callId,
						name: c % 3 === 0 ? "Bash" : c % 3 === 1 ? "Read" : "Grep",
						args: { command: `kubectl logs checkout-${turn}-${c} --tail=200` },
					},
				],
			});
			if (c % 4 === 1)
				events.push({
					kind: "thought",
					...base,
					seq: seq++,
					ts: ts(),
					text: words(40, turn * c),
				});
			const long = c % 5 === 0;
			events.push({
				kind: "tool_result",
				...base,
				seq: seq++,
				ts: ts(),
				result: {
					name: c % 3 === 0 ? "Bash" : c % 3 === 1 ? "Read" : "Grep",
					toolCallId: callId,
					source: `kubectl logs checkout-${turn}-${c} --tail=200`,
					ok: c % 11 !== 7,
					error: c % 11 === 7 ? "exit 1: pod not found" : null,
					preview: long ? logLines(160, turn * 100 + c) : logLines(6, turn + c),
				},
			});
		}
		if (special === 40) {
			events.push({
				kind: "compaction",
				...base,
				seq: seq++,
				ts: ts(),
				phase: "started",
				method: "agent_auto",
			});
			events.push({
				kind: "compaction",
				...base,
				seq: seq++,
				ts: ts(),
				phase: "completed",
				method: "agent_auto",
				before: 171_000,
				after: 11_900,
			});
		}
		if (special === 70)
			events.push({
				kind: "usage_limit",
				...base,
				seq: seq++,
				ts: ts(),
				agent: "claude-code",
				text: "You've hit your usage limit. It resets at 18:30.",
				resetsAt: new Date(t + 3 * 3600_000).toISOString(),
			});
		if (special === 100)
			events.push({
				kind: "error",
				...base,
				seq: seq++,
				ts: ts(),
				message: "Invalid API key: the agent's key was revoked (401).",
			});
		if (special === 110)
			events.push({
				kind: "error",
				...base,
				seq: seq++,
				ts: ts(),
				message: "The agent exited with code 137 while reading logs.",
			});
		events.push({
			kind: "agent_step",
			...base,
			seq: seq++,
			ts: ts(),
			text: `Turn ${turn} answer: ${words(30 + (turn % 40), turn * 3)}. The pool sizing is the likely cause.`,
			toolCalls: [],
		});
	}
	return events.slice(0, ITEMS);
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

	const longId = randomUUID();
	await prisma.investigation.create({
		data: {
			id: longId,
			kind: "chat",
			status: "completed",
			lastTurnOutcome: "answered",
			title: `Long thread (${ITEMS.toLocaleString("en")} items)`,
			harness: "claude-code",
			createdAt: new Date(now - DAY),
			startedAt: new Date(now - DAY),
			completedAt: new Date(now - 60_000),
			lastActivityAt: new Date(now - 60_000),
		},
	});
	const events = longThreadEvents(longId, now - DAY);
	for (let i = 0; i < events.length; i += 500)
		await prisma.investigationEvent.createMany({
			data: events.slice(i, i + 500).map((e) => ({
				investigationId: longId,
				seq: e.seq,
				branchId: "branchId" in e ? e.branchId : "__report__",
				event: JSON.stringify(e),
			})),
		});

	const states = ["completed", "running", "failed", "completed", "cancelled"];
	const rootId = randomUUID();
	await prisma.investigation.create({
		data: {
			id: rootId,
			kind: "chat",
			status: "completed",
			lastTurnOutcome: "answered",
			title: "Tree root: checkout 502s",
			rootId,
			createdAt: new Date(now - 2 * 3600_000),
			lastActivityAt: new Date(now - 30_000),
		},
	});
	const parents = [rootId];
	for (let i = 1; i < TREE; i++) {
		const id = randomUUID();
		const parentId = parents[Math.floor(i / 4)] ?? rootId;
		const status = states[i % states.length] as string;
		await prisma.investigation.create({
			data: {
				id,
				kind: "chat",
				status,
				...(status === "completed" ? { lastTurnOutcome: "answered" } : {}),
				title: `Child ${i}: ${words(4, i)}`,
				parentId,
				rootId,
				role: i % 2 ? "reviewer" : "explorer",
				depth: parentId === rootId ? 1 : 2,
				createdAt: new Date(now - 2 * 3600_000 + i * 60_000),
				lastActivityAt: new Date(now - (TREE - i) * 60_000),
			},
		});
		parents.push(id);
		const runId = randomUUID();
		await prisma.investigationEvent.createMany({
			data: [0, 1].map((seq) => ({
				investigationId: id,
				seq,
				branchId: "main",
				event: JSON.stringify(
					seq === 0
						? {
								kind: "operator_message",
								runId,
								branchId: "main",
								path: [],
								seq,
								ts: new Date(now - 3600_000).toISOString(),
								text: `Look at ${words(6, i)}`,
								mode: "queue",
								delivered: true,
							}
						: {
								kind: "agent_step",
								runId,
								branchId: "main",
								path: [],
								seq,
								ts: new Date(now - 3500_000).toISOString(),
								text: `Child ${i} found ${words(10, i * 2)}.`,
								toolCalls: [],
							},
				),
			})),
		});
	}
	console.log(
		`seed:long-thread: thread ${longId} (${events.length} events), tree root ${rootId} (${TREE} threads)`,
	);
	await prisma.$disconnect();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main().catch((err) => {
		console.error("seed:long-thread failed:", err);
		process.exit(1);
	});
