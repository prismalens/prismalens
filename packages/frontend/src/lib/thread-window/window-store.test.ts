// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	CommitFrame,
	DoneFrame,
	OpenThread,
	ThreadPage,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	SNAPSHOT_ITEMS,
	ThreadWindowStore,
} from "./window-store";

const RUN_ID = "00000000-0000-0000-0000-000000000001";

function operatorMessage(seq: number, text: string): CanonicalEvent {
	return {
		kind: "operator_message",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq,
		text,
		mode: "queue",
		delivered: true,
		ts: "2026-11-12T00:00:00Z",
	};
}

function agentStep(
	seq: number,
	toolCallId?: string,
): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq,
		label: null,
		text: "Working",
		toolCalls: toolCallId
			? [{ toolCallId, name: "read_file", args: {} }]
			: [],
		ts: "2026-11-12T00:00:00Z",
	};
}

function toolResult(
	seq: number,
	toolCallId: string,
): CanonicalEvent {
	return {
		kind: "tool_result",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq,
		result: {
			name: "read_file",
			toolCallId,
			source: "read_file()",
			ok: true,
			preview: "content",
		},
		ts: "2026-11-12T00:00:00Z",
	};
}

function makePage(
	gen: number,
	items: { key: string; ordinal: number | null; event: CanonicalEvent }[],
	opts: {
		lo: string | null;
		hi: string | null;
		hasBefore: boolean;
		hasAfter: boolean;
		revision?: number;
	},
): ThreadPage {
	return {
		gen,
		revision: opts.revision ?? 10,
		lo: opts.lo,
		hi: opts.hi,
		hasBefore: opts.hasBefore,
		hasAfter: opts.hasAfter,
		items: items.map((it) => ({
			key: it.key,
			ordinal: it.ordinal ?? 0,
			event: it.event,
		})),
		context: {
			stepsBefore: 0,
			endsBefore: 0,
			operatorsBefore: 0,
			agentBefore: false,
		},
		folded: [],
		target: null,
	};
}

function makeOpen(
	gen: number,
	page: ThreadPage,
	revision = 10,
): OpenThread {
	return {
		gen,
		revision,
		index: {
			gen,
			revision,
			total: page.items.length,
			lost: 0,
			turns: [],
			entries: [],
		},
		page,
		state: {
			openAsks: [],
			queue: [],
			hypotheses: [],
		},
		landing: null,
	};
}

describe("ThreadWindowStore", () => {
	it("applyOpen of a page holding keys main:1..main:3 with revision 10 sets through to 10. sorted() gives those keys in order. hasBefore and hasAfter come from the page.", () => {
		const store = new ThreadWindowStore();
		const p1 = operatorMessage(1, "one");
		const p2 = operatorMessage(2, "two");
		const p3 = operatorMessage(3, "three");
		const page = makePage(
			1,
			[
				{ key: "main:2", ordinal: 2, event: p2 },
				{ key: "main:1", ordinal: 1, event: p1 },
				{ key: "main:3", ordinal: 3, event: p3 },
			],
			{
				lo: "main:1",
				hi: "main:3",
				hasBefore: true,
				hasAfter: false,
				revision: 10,
			},
		);
		const open = makeOpen(1, page, 10);

		store.applyOpen(open);

		expect(store.through).toBe(10);
		expect(store.sorted().map((it) => it.key)).toEqual([
			"main:1",
			"main:2",
			"main:3",
		]);
		expect(store.hasBefore).toBe(true);
		expect(store.hasAfter).toBe(false);
	});

	it("After an open at main:2..main:3, applyPage(page, \"before\") with main:0 and main:1 adds them, moves lo to \"main:0\", and sets change to \"prepend\".", () => {
		const store = new ThreadWindowStore();
		const p2 = operatorMessage(2, "two");
		const p3 = operatorMessage(3, "three");
		const openPage = makePage(
			1,
			[
				{ key: "main:2", ordinal: 2, event: p2 },
				{ key: "main:3", ordinal: 3, event: p3 },
			],
			{
				lo: "main:2",
				hi: "main:3",
				hasBefore: true,
				hasAfter: false,
			},
		);
		store.applyOpen(makeOpen(1, openPage));

		const p0 = operatorMessage(0, "zero");
		const p1 = operatorMessage(1, "one");
		const beforePage = makePage(
			1,
			[
				{ key: "main:0", ordinal: 0, event: p0 },
				{ key: "main:1", ordinal: 1, event: p1 },
			],
			{
				lo: "main:0",
				hi: "main:1",
				hasBefore: false,
				hasAfter: true,
			},
		);

		store.applyPage(beforePage, "before");

		expect(store.sorted().map((it) => it.key)).toEqual([
			"main:0",
			"main:1",
			"main:2",
			"main:3",
		]);
		expect(store.lo).toBe("main:0");
		expect(store.change).toBe("prepend");
	});

	it("applyLive(gen, event) with an event past hi on a window with hasAfter false inserts it with ordinal null and moves hi to it.", () => {
		const store = new ThreadWindowStore();
		const p1 = operatorMessage(1, "one");
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: p1 }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: false,
			},
		);
		store.applyOpen(makeOpen(1, page));

		const liveEvent = operatorMessage(2, "two");
		store.applyLive(1, liveEvent);

		const items = store.sorted();
		expect(items.map((it) => it.key)).toEqual(["main:1", "main:2"]);
		expect(items[1]?.ordinal).toBeNull();
		expect(store.hi).toBe("main:2");
	});

	it("With hasAfter true, an operator_message past hi is not inserted, and newCount becomes 1.", () => {
		const store = new ThreadWindowStore();
		const p1 = operatorMessage(1, "one");
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: p1 }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: true,
			},
		);
		store.applyOpen(makeOpen(1, page));

		const pastEvent = operatorMessage(2, "two");
		store.applyLive(1, pastEvent);

		expect(store.sorted().map((it) => it.key)).toEqual(["main:1"]);
		expect(store.newCount).toBe(1);
	});

	it("A tool_result whose call's agent_step is in the window is inserted even when its key is past hi with hasAfter true.", () => {
		const store = new ThreadWindowStore();
		const step = agentStep(1, "call-1");
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: step }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: true,
			},
		);
		store.applyOpen(makeOpen(1, page));

		const resultEvent = toolResult(5, "call-1");
		store.applyLive(1, resultEvent);

		expect(store.sorted().map((it) => it.key)).toEqual(["main:1", "main:5"]);
	});

	it("applyCommit with an ack [\"main:9\", 12] for a provisional item sets its ordinal to 12 and moves through to the frame's through.", () => {
		const store = new ThreadWindowStore();
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: operatorMessage(1, "one") }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: false,
			},
		);
		store.applyOpen(makeOpen(1, page, 5));

		const provisional = operatorMessage(9, "nine");
		store.applyLive(1, provisional);
		expect(store.items.get("main:9")?.ordinal).toBeNull();

		const commitFrame: CommitFrame = {
			gen: 1,
			through: 15,
			events: [],
			acks: [["main:9", 12]],
		};
		store.applyCommit(commitFrame);

		expect(store.items.get("main:9")?.ordinal).toBe(12);
		expect(store.through).toBe(15);
	});

	it("applyDone removes every item whose ordinal is still null, and unsaved equals the number removed.", () => {
		const store = new ThreadWindowStore();
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: operatorMessage(1, "one") }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: false,
			},
		);
		store.applyOpen(makeOpen(1, page));

		store.applyLive(1, operatorMessage(2, "two"));
		store.applyLive(1, operatorMessage(3, "three"));
		expect(store.items.size).toBe(3);

		const doneFrame: DoneFrame = {
			gen: 1,
			through: 10,
			lost: 0,
		};
		store.applyDone(doneFrame);

		expect(store.sorted().map((it) => it.key)).toEqual(["main:1"]);
		expect(store.unsaved).toBe(2);
	});

	it("Frames whose gen differs from the store's are ignored: version is unchanged.", () => {
		const store = new ThreadWindowStore();
		const page = makePage(
			1,
			[{ key: "main:1", ordinal: 1, event: operatorMessage(1, "one") }],
			{
				lo: "main:1",
				hi: "main:1",
				hasBefore: false,
				hasAfter: false,
			},
		);
		store.applyOpen(makeOpen(1, page));
		const currentVersion = store.getVersion();

		store.applyLive(2, operatorMessage(2, "two"));
		expect(store.getVersion()).toBe(currentVersion);

		store.applyCommit({
			gen: 2,
			through: 20,
			events: [],
			acks: [],
		});
		expect(store.getVersion()).toBe(currentVersion);

		store.applyDone({
			gen: 2,
			through: 20,
			lost: 0,
		});
		expect(store.getVersion()).toBe(currentVersion);
	});

	it("snapshot() keeps committed items only, at most SNAPSHOT_ITEMS, and hydrate(snapshot) on a fresh store gives the same sorted() keys and source \"cached\".", () => {
		const store = new ThreadWindowStore();
		const committedItems = Array.from({ length: SNAPSHOT_ITEMS + 10 }, (_, i) => ({
			key: `main:${i + 1}`,
			ordinal: i + 1,
			event: operatorMessage(i + 1, `msg-${i + 1}`),
		}));
		const page = makePage(1, committedItems, {
			lo: "main:1",
			hi: `main:${SNAPSHOT_ITEMS + 10}`,
			hasBefore: false,
			hasAfter: false,
		});
		store.applyOpen(makeOpen(1, page));

		// Add an uncommitted provisional item
		store.applyLive(1, operatorMessage(9999, "provisional"));

		const snap = store.snapshot();
		expect(snap).not.toBeNull();
		if (!snap) return;

		expect(snap.items.length).toBe(SNAPSHOT_ITEMS);
		expect(snap.items.every((it) => it.ordinal !== null)).toBe(true);
		expect(snap.items.some((it) => it.key === "main:9999")).toBe(false);

		const freshStore = new ThreadWindowStore();
		freshStore.hydrate(snap);

		expect(freshStore.sorted().map((it) => it.key)).toEqual(
			snap.items.map((it) => it.key),
		);
		expect(freshStore.source).toBe("cached");
	});

	it("applyOpen after hydrate replaces the cached items, and source becomes \"server\".", () => {
		const store = new ThreadWindowStore();
		const cachedItems = [
			{
				key: "main:1",
				ordinal: 1,
				event: operatorMessage(1, "cached 1"),
			},
		];
		const snapPage = makePage(1, cachedItems, {
			lo: "main:1",
			hi: "main:1",
			hasBefore: false,
			hasAfter: false,
		});
		const initialStore = new ThreadWindowStore();
		initialStore.applyOpen(makeOpen(1, snapPage));
		const snap = initialStore.snapshot();
		expect(snap).not.toBeNull();
		if (!snap) return;

		store.hydrate(snap);
		expect(store.source).toBe("cached");
		expect(store.sorted().map((it) => it.key)).toEqual(["main:1"]);

		const serverItems = [
			{
				key: "main:2",
				ordinal: 2,
				event: operatorMessage(2, "server 2"),
			},
			{
				key: "main:3",
				ordinal: 3,
				event: operatorMessage(3, "server 3"),
			},
		];
		const serverPage = makePage(1, serverItems, {
			lo: "main:2",
			hi: "main:3",
			hasBefore: true,
			hasAfter: false,
		});
		store.applyOpen(makeOpen(1, serverPage));

		expect(store.sorted().map((it) => it.key)).toEqual(["main:2", "main:3"]);
		expect(store.source).toBe("server");
	});
});
