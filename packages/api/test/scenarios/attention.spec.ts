// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AttentionEvents,
	AwayView,
	ThreadRead,
} from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
const ASK = "fake-session:echo Summarise the retry helper";
let threadId: string;

async function finished(id: string) {
	await eventually(
		() => pl.api<{ status: string }>(`/investigations/${id}`),
		(i) => !["pending", "running"].includes(i.status),
		"the run to end",
		30_000,
	);
}

async function unread(): Promise<AttentionEvents> {
	return pl.api<AttentionEvents>("/attention/events?filter=unread&limit=50");
}

beforeAll(async () => {
	await pl.boot();
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: { subject: { kind: "none" }, text: ASK, place: "alerts" },
	});
	threadId = started.investigationId;
	await finished(threadId);
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

describe("attention: read state, presence and the away view (#1101 categories 3 and 4)", () => {
	it("records a finish of a thread the operator started, and it may notify", async () => {
		const events = await eventually(
			unread,
			(e) => e.events.some((x) => x.threadId === threadId),
			"the finish to be recorded",
		);
		const mine = events.events.filter((x) => x.threadId === threadId);
		expect(mine.map((x) => [x.kind, x.notify, x.silenced])).toEqual([
			["finished", true, false],
		]);
		// The echo session says its whole prompt back; the answer is its newest sentence.
		expect(mine[0]?.thread.answer).toMatch(/^You are a coding assistant/);
	}, 30_000);

	it("silences a finish while a device holds a lease on that thread", async () => {
		await pl.api("/attention/presence", {
			method: "POST",
			body: { threadId, visible: true },
		});
		await pl.api(`/investigations/${threadId}/messages`, {
			method: "POST",
			body: { text: "fake-session:echo And the backoff?" },
		});
		await finished(threadId);
		const events = await eventually(
			unread,
			(e) => e.events.filter((x) => x.threadId === threadId).length === 2,
			"the second finish to be recorded",
		);
		const newest = events.events.find((x) => x.threadId === threadId);
		expect(newest?.silenced).toBe(true);
		await pl.api("/attention/presence", {
			method: "POST",
			body: { threadId: null, visible: false },
		});
	}, 30_000);

	it("reading the thread to its tail marks its events read and never moves back", async () => {
		const before = await pl.api<ThreadRead>(`/threads/${threadId}/read`);
		expect(before).toEqual({ readAt: null, firstUnseen: null, newCount: 0 });
		const page = await pl.api<{ events: Array<{ seq: number; branchId: string; kind: string }> }>(
			`/investigations/${threadId}/events`,
		);
		const last = page.events.at(-1);
		const first = page.events[0];
		expect(last).toBeTruthy();
		const tail = `${last?.branchId}:${last?.seq}`;
		expect(
			await pl.api(`/threads/${threadId}/read`, {
				method: "POST",
				body: { key: tail },
			}),
		).toEqual({ advanced: true });
		expect(
			await pl.api(`/threads/${threadId}/read`, {
				method: "POST",
				body: { key: `${first?.branchId}:${first?.seq}` },
			}),
		).toEqual({ advanced: false });
		const left = (await unread()).events.filter((x) => x.threadId === threadId);
		expect(left).toEqual([]);
		const after = await pl.api<ThreadRead>(`/threads/${threadId}/read`);
		expect(after.firstUnseen).toBeNull();
		expect(after.newCount).toBe(0);
	}, 30_000);

	it("a visible tab after a long gap opens a long away view since the last visit", async () => {
		const prisma = await pl.prisma();
		const lastSeen = new Date(Date.now() - 3 * 60 * 60_000);
		await prisma.setting.upsert({
			where: { key: "attention.activity" },
			create: {
				key: "attention.activity",
				value: JSON.stringify({ lastActiveAt: lastSeen.toISOString(), awaySince: null, gapMs: 0 }),
				type: "json",
			},
			update: {
				value: JSON.stringify({ lastActiveAt: lastSeen.toISOString(), awaySince: null, gapMs: 0 }),
			},
		});
		await pl.api("/attention/presence", {
			method: "POST",
			body: { threadId: null, visible: true },
		});
		const away = await pl.api<AwayView>("/attention/away");
		expect(away.since).toBe(lastSeen.toISOString());
		expect(away.long).toBe(true);
	}, 30_000);
});
