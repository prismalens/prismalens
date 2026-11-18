// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { INVESTIGATION_REPORT_BRANCH } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { TOOL_ASK_BRANCH } from "../../modules/asks/asks.service.js";
import { TREE_BRANCH } from "../../modules/thread-tree/tree-text.js";
import { LINKS_BRANCH } from "../../modules/threads/pull-requests.service.js";
import { WATCHES_BRANCH } from "../../modules/threads/thread-watches.service.js";
import { LiveChanges, mergeChanges } from "./live-changes.js";
import { NON_AGENT_BRANCHES } from "./step-text.js";

async function firstChange(live: LiveChanges, act: () => void) {
	const controller = new AbortController();
	const stream = live.subscribe(controller.signal);
	const next = stream.next();
	act();
	const { value } = await next;
	controller.abort();
	await stream.return(undefined);
	return value && "topics" in value ? value : undefined;
}

describe("LiveChanges (walk f27)", () => {
	it("sends one hint for a burst of writes, naming each list once", async () => {
		const live = new LiveChanges(10);
		const change = await firstChange(live, () => {
			live.noteWrite("Alert", "create");
			live.noteWrite("Incident", "create");
			live.noteWrite("TimelineEntry", "create");
			live.noteWrite("Investigation", "update");
		});
		expect(change?.topics.sort()).toEqual([
			"alerts",
			"incidents",
			"investigations",
		]);
	});

	it("ignores reads and models no list shows", async () => {
		const live = new LiveChanges(10);
		const change = await firstChange(live, () => {
			live.noteWrite("Incident", "findMany");
			live.noteWrite("Setting", "update");
			live.noteWrite("Incident", "update");
		});
		expect(change?.topics).toEqual(["incidents"]);
	});

	it("sends a topic noted directly, for a shared model no list maps (#1020)", async () => {
		const live = new LiveChanges(10);
		const change = await firstChange(live, () => live.noteTopic("threads"));
		expect(change?.topics).toEqual(["threads"]);
	});

	it("wakes the thread list for an agent's events, once per slower window (#1020)", async () => {
		const live = new LiveChanges(1, 30);
		const seen: string[][] = [];
		const controller = new AbortController();
		const reader = (async () => {
			for await (const change of live.subscribe(controller.signal)) {
				if ("topics" in change) seen.push(change.topics);
			}
		})();
		live.noteWrite("InvestigationEvent", "create");
		await new Promise((r) => setTimeout(r, 10));
		live.noteWrite("InvestigationEvent", "create");
		live.noteWrite("Alert", "create");
		await new Promise((r) => setTimeout(r, 10));
		expect(seen).toEqual([["alerts"]]);
		await new Promise((r) => setTimeout(r, 40));
		expect(seen).toEqual([["alerts"], ["threads"]]);
		controller.abort();
		await reader;
	});

	it("ends a subscription quietly when the browser goes away", async () => {
		const live = new LiveChanges(10);
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal);
		const next = stream.next();
		controller.abort();
		await expect(next).resolves.toEqual({ done: true, value: undefined });
	});

	it("keeps one merged hint for a subscriber that has not read yet", async () => {
		const live = new LiveChanges(1);
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal);
		const first = stream.next();
		live.noteWrite("Alert", "create");
		await first;
		for (const model of ["Incident", "Alert", "Investigation", "Incident"]) {
			live.noteWrite(model, "update");
			await new Promise((r) => setTimeout(r, 5));
		}
		const { value } = await stream.next();
		expect(value && "topics" in value ? value.topics.sort() : []).toEqual([
			"alerts",
			"incidents",
			"investigations",
		]);
		controller.abort();
		await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
	});

	it("sends a transaction's hints only after it commits, and none on rollback", async () => {
		const live = new LiveChanges(1);
		const seen: string[][] = [];
		const controller = new AbortController();
		const reader = (async () => {
			for await (const change of live.subscribe(controller.signal)) {
				if ("topics" in change) seen.push(change.topics);
			}
		})();
		await expect(
			live.afterCommit(async () => {
				live.noteWrite("Alert", "update");
				throw new Error("rolled back");
			}),
		).rejects.toThrow("rolled back");
		await live.afterCommit(async () => {
			live.noteWrite("Incident", "update");
			await new Promise((r) => setTimeout(r, 20));
			expect(seen).toEqual([]);
		});
		await new Promise((r) => setTimeout(r, 20));
		expect(seen).toEqual([["incidents"]]);
		controller.abort();
		await reader;
	});
});

describe("Investigation classification (#1181)", () => {
	it("{lastActivityAt} (+updatedAt) sends nothing", async () => {
		const live = new LiveChanges(10, 20);
		let sent = false;
		const controller = new AbortController();
		const reader = (async () => {
			for await (const _ of live.subscribe(controller.signal)) sent = true;
		})();
		live.noteWrite("Investigation", "update", {
			where: { id: "inv-1" },
			data: { lastActivityAt: new Date(), updatedAt: new Date() },
		});
		await new Promise((r) => setTimeout(r, 50));
		controller.abort();
		await reader;
		expect(sent).toBe(false);
	});

	it("{lastVisitedAt} sends visits and schedules", async () => {
		const live = new LiveChanges(10, 10);
		const seen: string[][] = [];
		const controller = new AbortController();
		const reader = (async () => {
			for await (const change of live.subscribe(controller.signal)) {
				if ("topics" in change) seen.push(change.topics.sort());
			}
		})();
		live.noteWrite("Investigation", "update", {
			where: { id: "inv-1" },
			data: { lastVisitedAt: new Date() },
		});
		await new Promise((r) => setTimeout(r, 40));
		controller.abort();
		await reader;
		expect(seen.flat().sort()).toEqual(["schedules", "visits"]);
	});

	it("{usage, lastActivityAt} with where.id sends no list topic but detail: [id] on that thread's edge", async () => {
		const live = new LiveChanges(10, 20);
		const change = await firstChange(live, () => {
			live.noteWrite("Investigation", "update", {
				where: { id: "inv-1" },
				data: { usage: 100, lastActivityAt: new Date() },
			});
		});
		expect(change?.topics).not.toContain("investigations");
		expect(change?.detail).toEqual(["inv-1"]);
	});

	it("{usage} without a string where.id sends unscoped investigations", async () => {
		const live = new LiveChanges(10, 20);
		const change = await firstChange(live, () => {
			live.noteWrite("Investigation", "updateMany", {
				where: {},
				data: { usage: 100 },
			});
		});
		expect(change?.topics).toEqual(["investigations"]);
		expect(change?.scope).toBeUndefined();
	});

	it("any other key sends investigations scoped to where.id", async () => {
		const live = new LiveChanges(10, 20);
		const change = await firstChange(live, () => {
			live.noteWrite("Investigation", "update", {
				where: { id: "inv-1" },
				data: { title: "New title" },
			});
		});
		expect(change?.topics).toEqual(["investigations"]);
		expect(change?.scope).toEqual(["inv-1"]);
	});
});

describe("InvestigationEvent create classification (#1181)", () => {
	it("agent_step produces activity and leading-edge scoped threads hint", async () => {
		const live = new LiveChanges(10, 20, 10_000, 20);
		const change = await firstChange(live, () => {
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({
						kind: "agent_step",
						text: "Analyzing logs",
					}),
					createdAt: "2026-11-18T00:00:00.000Z",
				},
			);
		});
		expect(change?.activity).toEqual([
			{
				id: "inv-1",
				at: "2026-11-18T00:00:00.000Z",
				text: "Analyzing logs",
			},
		]);
		expect(change?.topics).toEqual(["threads"]);
		expect(change?.scope).toEqual(["inv-1"]);
	});

	it("NON_AGENT_BRANCHES produce scoped threads and no activity", async () => {
		for (const branchId of NON_AGENT_BRANCHES) {
			const live = new LiveChanges(10, 20);
			const change = await firstChange(live, () => {
				live.noteWrite(
					"InvestigationEvent",
					"create",
					{},
					{
						investigationId: "inv-1",
						branchId,
						event: JSON.stringify({
							kind: "agent_step",
							text: "Ignored text",
						}),
						createdAt: "2026-11-18T00:00:00.000Z",
					},
				);
			});
			expect(change?.topics).toEqual(["threads"]);
			expect(change?.scope).toEqual(["inv-1"]);
			expect(change?.activity).toBeUndefined();
		}
	});

	it("ask_* and permission_* kinds produce scoped threads and no activity", async () => {
		for (const kind of ["ask_confirmation", "permission_request"]) {
			const live = new LiveChanges(10, 20);
			const change = await firstChange(live, () => {
				live.noteWrite(
					"InvestigationEvent",
					"create",
					{},
					{
						investigationId: "inv-1",
						branchId: "run",
						event: JSON.stringify({ kind, text: "Can I run this?" }),
						createdAt: "2026-11-18T00:00:00.000Z",
					},
				);
			});
			expect(change?.topics).toEqual(["threads"]);
			expect(change?.scope).toEqual(["inv-1"]);
			expect(change?.activity).toBeUndefined();
		}
	});

	it("NON_AGENT_BRANCHES equals the module constants plus workspace", () => {
		expect(NON_AGENT_BRANCHES).toEqual(
			new Set([
				TOOL_ASK_BRANCH,
				WATCHES_BRANCH,
				TREE_BRANCH,
				LINKS_BRANCH,
				INVESTIGATION_REPORT_BRANCH,
				"workspace",
			]),
		);
	});
});

describe("Edges and topicVersion (#1181)", () => {
	it("first activity produces leading edge; activity within 10s produces trailing edge at +10s; pruned without activity", async () => {
		vi.useFakeTimers();
		try {
			const live = new LiveChanges(10, 20, 10_000, 20);
			const seen: unknown[] = [];
			const controller = new AbortController();
			void (async () => {
				for await (const c of live.subscribe(controller.signal)) seen.push(c);
			})();

			// First activity -> leading edge now
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 1" }),
					createdAt: "2026-11-18T00:00:00.000Z",
				},
			);
			await vi.advanceTimersByTimeAsync(20);
			expect(seen).toHaveLength(1);
			expect((seen[0] as { topics: string[] }).topics).toEqual(["threads"]);

			// More activity within 10s
			await vi.advanceTimersByTimeAsync(2_000);
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 2" }),
					createdAt: "2026-11-18T00:00:02.000Z",
				},
			);
			await vi.advanceTimersByTimeAsync(20);
			// Emitted activity frame without edge topic
			expect(seen).toHaveLength(2);

			// At +10s from first edge, trailing edge fires
			await vi.advanceTimersByTimeAsync(8_000);
			expect(seen).toHaveLength(3);
			expect((seen[2] as { topics: string[] }).topics).toEqual(["threads"]);

			// No activity after trailing edge -> timer fires at +10s, entry pruned
			await vi.advanceTimersByTimeAsync(10_000);
			// No extra frames
			expect(seen).toHaveLength(3);
			// Pruned: next activity is leading edge again
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 3" }),
					createdAt: "2026-11-18T00:00:20.000Z",
				},
			);
			await vi.advanceTimersByTimeAsync(20);
			expect(seen).toHaveLength(4);
			expect((seen[3] as { topics: string[] }).topics).toEqual(["threads"]);

			controller.abort();
		} finally {
			vi.useRealTimers();
		}
	});

	it("usage-only write arms the trailing edge and that edge carries detail", async () => {
		vi.useFakeTimers();
		try {
			const live = new LiveChanges(10, 20, 10_000, 20);
			const seen: unknown[] = [];
			const controller = new AbortController();
			void (async () => {
				for await (const c of live.subscribe(controller.signal)) seen.push(c);
			})();

			// Leading edge from initial activity
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 1" }),
					createdAt: "2026-11-18T00:00:00.000Z",
				},
			);
			await vi.advanceTimersByTimeAsync(20);
			expect(seen).toHaveLength(1);

			// Usage write within 10s arms trailing edge
			await vi.advanceTimersByTimeAsync(2_000);
			live.noteWrite("Investigation", "update", {
				where: { id: "inv-1" },
				data: { usage: 42, lastActivityAt: new Date() },
			});
			// Batch flushes at 20ms, but edge hasn't fired yet
			await vi.advanceTimersByTimeAsync(20);
			expect(seen).toHaveLength(1);

			// At 10s, trailing edge fires and carries detail
			await vi.advanceTimersByTimeAsync(8_000);
			expect(seen).toHaveLength(2);
			const trailing = seen[1] as { detail?: string[]; topics: string[] };
			expect(trailing.topics).toEqual(["threads"]);
			expect(trailing.detail).toEqual(["inv-1"]);

			controller.abort();
		} finally {
			vi.useRealTimers();
		}
	});

	it("topicVersion bumps on noted topic and on edges; activity alone does not bump it", () => {
		vi.useFakeTimers();
		try {
			const live = new LiveChanges(10, 20, 10_000, 20);
			const initialVersion = live.topicVersion;

			// Direct noted topic bumps topicVersion (and again on flush)
			live.noteTopic("incidents");
			expect(live.topicVersion).toBe(initialVersion + 1);
			vi.advanceTimersByTime(10);
			expect(live.topicVersion).toBe(initialVersion + 2);

			// First activity starts leading edge -> calls noteTopic("threads") -> bumps version
			const v1 = live.topicVersion;
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 1" }),
					createdAt: "2026-11-18T00:00:00.000Z",
				},
			);
			expect(live.topicVersion).toBe(v1 + 1);
			vi.advanceTimersByTime(20); // flush
			expect(live.topicVersion).toBe(v1 + 2);

			// Subsequent activity alone within 10s does NOT bump topicVersion
			const v2 = live.topicVersion;
			live.noteWrite(
				"InvestigationEvent",
				"create",
				{},
				{
					investigationId: "inv-1",
					branchId: "run",
					event: JSON.stringify({ kind: "agent_step", text: "step 2" }),
					createdAt: "2026-11-18T00:00:01.000Z",
				},
			);
			expect(live.topicVersion).toBe(v2);
			vi.advanceTimersByTime(20); // flush has no topics
			expect(live.topicVersion).toBe(v2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("Replay and cursors (#1181)", () => {
	it("subscribe with after equal to current cursor yields nothing until new frame", async () => {
		const live = new LiveChanges(10, 20);
		const current = live.cursor();
		const controller = new AbortController();
		let got = false;
		const reader = (async () => {
			for await (const _ of live.subscribe(controller.signal, current)) got = true;
		})();
		await new Promise((r) => setTimeout(r, 40));
		expect(got).toBe(false);
		live.noteTopic("alerts");
		await new Promise((r) => setTimeout(r, 40));
		expect(got).toBe(true);
		controller.abort();
		await reader;
	});

	it("subscribe with older cursor in ring yields one merged frame", async () => {
		const live = new LiveChanges(5, 5);
		const c0 = live.cursor();
		live.noteTopic("alerts");
		await new Promise((r) => setTimeout(r, 15));
		live.noteTopic("incidents");
		await new Promise((r) => setTimeout(r, 15));

		const controller = new AbortController();
		const stream = live.subscribe(controller.signal, c0);
		const { value } = await stream.next();
		expect(value && "topics" in value ? value.topics.sort() : []).toEqual([
			"alerts",
			"incidents",
		]);
		controller.abort();
	});

	it("another epoch or cursor older than ring yields reset: true", async () => {
		const live = new LiveChanges(5, 5);
		const controller = new AbortController();

		// Different epoch
		const stream1 = live.subscribe(controller.signal, "other-epoch.0");
		const r1 = await stream1.next();
		expect(r1.value).toEqual({ reset: true, cursor: live.cursor() });

		// Older than ring
		const stream2 = live.subscribe(controller.signal, `${live.cursor().split(".")[0]}.-5`);
		const r2 = await stream2.next();
		expect(r2.value).toEqual({ reset: true, cursor: live.cursor() });

		controller.abort();
	});

	it("no after and no sent produces no reset", async () => {
		const live = new LiveChanges(5, 5);
		const controller = new AbortController();
		let resetSeen = false;
		const reader = (async () => {
			for await (const c of live.subscribe(controller.signal)) {
				if ("reset" in c) resetSeen = true;
			}
		})();
		await new Promise((r) => setTimeout(r, 20));
		expect(resetSeen).toBe(false);
		controller.abort();
		await reader;
	});

	it("frame flushed before first next() is delivered when sent cursor is provided", async () => {
		const live = new LiveChanges(5, 5);
		const sent = { cursor: live.cursor() };
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal, undefined, sent);

		// Note write and flush before calling stream.next()
		live.noteTopic("alerts");
		await new Promise((r) => setTimeout(r, 20));

		const { value } = await stream.next();
		expect(value && "topics" in value ? value.topics : []).toEqual(["alerts"]);
		controller.abort();
	});

	it("sent.cursor follows every yielded frame or reset", async () => {
		const live = new LiveChanges(5, 5);
		const sent = { cursor: "unknown" };
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal, "bad.0", sent);

		// First is reset
		const r1 = await stream.next();
		expect(sent.cursor).toBe((r1.value as { cursor: string }).cursor);

		// Next is a frame
		live.noteTopic("alerts");
		const r2 = await stream.next();
		expect(sent.cursor).toBe((r2.value as { cursor: string }).cursor);

		controller.abort();
	});

	it("afterCommit keeps args and result so event create produces activity", async () => {
		const live = new LiveChanges(10, 20);
		const change = await firstChange(live, () => {
			void live.afterCommit(async () => {
				live.noteWrite(
					"InvestigationEvent",
					"create",
					{},
					{
						investigationId: "inv-tx",
						branchId: "run",
						event: JSON.stringify({
							kind: "agent_step",
							text: "committed step",
						}),
						createdAt: "2026-11-18T00:00:00.000Z",
					},
				);
			});
		});
		expect(change?.activity).toEqual([
			{
				id: "inv-tx",
				at: "2026-11-18T00:00:00.000Z",
				text: "committed step",
			},
		]);
	});
});

describe("mergeChanges (#1181)", () => {
	it("combines union of topics and detail", () => {
		const a = {
			cursor: "e.1",
			topics: ["alerts" as const],
			detail: ["d1"],
		};
		const b = {
			cursor: "e.2",
			topics: ["incidents" as const],
			detail: ["d2"],
		};
		const merged = mergeChanges(a, b);
		expect(merged.topics.sort()).toEqual(["alerts", "incidents"]);
		expect(merged.detail?.sort()).toEqual(["d1", "d2"]);
		expect(merged.cursor).toBe("e.2");
	});

	it("drops scope when either side has scoped topic without scope", () => {
		const a = {
			cursor: "e.1",
			topics: ["threads" as const],
			scope: ["t1"],
		};
		const b = {
			cursor: "e.2",
			topics: ["threads" as const],
		};
		const merged = mergeChanges(a, b);
		expect(merged.scope).toBeUndefined();

		const c = {
			cursor: "e.3",
			topics: ["threads" as const],
			scope: ["t2"],
		};
		const mergedScoped = mergeChanges(a, c);
		expect(mergedScoped.scope?.sort()).toEqual(["t1", "t2"]);
	});

	it("keeps latest activity per id and preserves text if newer has none", () => {
		const a = {
			cursor: "e.1",
			topics: [],
			activity: [
				{ id: "t1", at: "2026-11-18T01:00:00.000Z", text: "step 1" },
			],
		};
		const b = {
			cursor: "e.2",
			topics: [],
			activity: [{ id: "t1", at: "2026-11-18T02:00:00.000Z" }],
		};
		const merged = mergeChanges(a, b);
		expect(merged.activity).toEqual([
			{ id: "t1", at: "2026-11-18T02:00:00.000Z", text: "step 1" },
		]);
	});

	it("keeps later cursor regardless of parameter order", () => {
		const a = { cursor: "e.5", topics: [] };
		const b = { cursor: "e.2", topics: [] };
		expect(mergeChanges(a, b).cursor).toBe("e.5");
		expect(mergeChanges(b, a).cursor).toBe("e.5");
	});
});
