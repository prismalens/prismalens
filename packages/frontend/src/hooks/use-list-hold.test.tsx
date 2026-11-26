// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow, ThreadUnit } from "@prismalens/contracts";
import { act, createElement, Suspense, startTransition, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ThreadListModel, threadList } from "@/lib/thread-list";
import {
	RELEASE_MS,
	TOUCH_MS,
	useListHold,
	userMovedThreads,
} from "./use-list-hold";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const unit = (id: string, status: string, at: string): ThreadUnit => ({
	section: "active",
	incident: null,
	threads: [
		{
			id,
			title: id,
			status: "completed",
			kind: "chat",
			origin: "local",
			schemaVersion: 1,
			createdAt: at,
			updatedAt: at,
			lastActivityAt: at,
			lastVisitedAt: at,
			settledAt: null,
			unseen: false,
			latestText: null,
			projectName: null,
			titleSetBy: null,
			serviceName: null,
			section: "active",
			state: { status },
		} as unknown as ThreadRow,
	],
});

const first = threadList([
	unit("a", "working", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T10:00:00.000Z"),
]);
// b streams and becomes newest; a asks the reader something.
const next = threadList([
	unit("a", "question", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T11:30:00.000Z"),
]);

// c starts waiting too, on its own: nothing the reader did.
const third = threadList([
	unit("a", "question", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T11:30:00.000Z"),
	unit("c", "question", "2026-11-12T09:00:00.000Z"),
]);
const firstWithC = threadList([
	unit("a", "working", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T10:00:00.000Z"),
	unit("c", "working", "2026-11-12T09:00:00.000Z"),
]);
// d arrives, so the count of held moves changes.
const withD = threadList([
	unit("a", "question", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T11:30:00.000Z"),
	unit("c", "question", "2026-11-12T09:00:00.000Z"),
	unit("d", "working", "2026-11-12T08:00:00.000Z"),
]);
// The next page brings an older thread; a newer one arrives on top at the same time.
const paged = threadList([
	unit("n", "working", "2026-11-12T11:45:00.000Z"),
	unit("a", "working", "2026-11-12T11:00:00.000Z"),
	unit("b", "working", "2026-11-12T10:00:00.000Z"),
	unit("old", "working", "2026-11-12T07:00:00.000Z"),
]);
// b starts waiting after a's move was applied.
const fourth = threadList([
	unit("a", "question", "2026-11-12T11:00:00.000Z"),
	unit("b", "question", "2026-11-12T11:30:00.000Z"),
]);

let container: HTMLDivElement;
let root: Root;
let seen: {
	needs: string[];
	active: string[];
	pending: number;
	update: () => void;
	expectMore: () => void;
};

function Probe({
	model,
	loading = false,
}: {
	model: ThreadListModel;
	loading?: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const held = useListHold(ref, model);
	seen = {
		needs: held.model.needs.map((n) => n.id),
		active: held.model.active.map((n) => n.id),
		pending: held.pending,
		update: held.update,
		expectMore: held.expectMore,
	};
	if (loading) return createElement("p", null, "Loading");
	return createElement(
		"div",
		{ ref, "data-testid": "list" },
		createElement("button", { type: "button" }, "row"),
	);
}

const draw = (model: ThreadListModel, loading = false) =>
	act(async () => root.render(createElement(Probe, { model, loading })));
const list = () =>
	container.querySelector('[data-testid="list"]') as HTMLElement;
const pointer = (type: string, pointerType = "mouse") =>
	act(async () => {
		list().dispatchEvent(new PointerEvent(type, { pointerType }));
	});

beforeEach(() => {
	vi.useFakeTimers({ now: Date.parse("2026-11-12T12:00:00.000Z") });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

describe("useListHold keeps the list still while the reader is in it (#1247 D25)", () => {
	it("moves rows at once when nobody is in the list", async () => {
		await draw(first);
		await draw(next);
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 0 });
	});

	it("holds both moves while the pointer is over the list, then applies them 600 ms after it leaves", async () => {
		await draw(first);
		await pointer("pointerenter");
		await draw(next);
		expect(seen).toMatchObject({ needs: [], active: ["a", "b"], pending: 1 });
		await pointer("pointerleave");
		await act(async () => vi.advanceTimersByTime(RELEASE_MS - 1));
		expect(seen.active).toEqual(["a", "b"]);
		await act(async () => vi.advanceTimersByTime(1));
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 0 });
	});

	it("holds while focus is inside the list, after the pointer has gone", async () => {
		await draw(first);
		(list().querySelector("button") as HTMLButtonElement).focus();
		await draw(next);
		await pointer("pointerleave");
		await act(async () => vi.advanceTimersByTime(RELEASE_MS * 3));
		expect(seen).toMatchObject({ needs: [], active: ["a", "b"], pending: 1 });
	});

	it("holds for 2 s after a touch, then applies the move", async () => {
		await draw(first);
		await pointer("pointerenter", "touch");
		await draw(next);
		expect(seen.active).toEqual(["a", "b"]);
		await pointer("pointerleave", "touch");
		await act(async () => vi.advanceTimersByTime(TOUCH_MS - RELEASE_MS));
		expect(seen.active).toEqual(["a", "b"]);
		await act(async () => vi.advanceTimersByTime(TOUCH_MS));
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 0 });
	});

	it("applies held moves on Update while the pointer stays, and holds from there", async () => {
		await draw(first);
		await pointer("pointerenter");
		await draw(next);
		await act(async () => seen.update());
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 0 });
		await draw(fourth);
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 1 });
	});

	it("applies only the move the reader caused (pin, archive); another thread's move still waits", async () => {
		await draw(firstWithC);
		await pointer("pointerenter");
		userMovedThreads(["a"]);
		await draw(third);
		expect(seen).toMatchObject({
			needs: ["a"],
			active: ["b", "c"],
			pending: 1,
		});
	});

	it("holds a list that mounts after a loading render", async () => {
		await draw(first, true);
		await draw(first);
		await pointer("pointerenter");
		await draw(next);
		expect(seen).toMatchObject({ needs: [], active: ["a", "b"], pending: 1 });
		await pointer("pointerleave");
		await act(async () => vi.advanceTimersByTime(RELEASE_MS));
		expect(seen).toMatchObject({ needs: ["a"], active: ["b"], pending: 0 });
	});

	it("keeps the release 600 ms after the reader left though more moves arrive meanwhile", async () => {
		await draw(firstWithC);
		await pointer("pointerenter");
		await draw(next);
		await pointer("pointerleave");
		await act(async () => vi.advanceTimersByTime(RELEASE_MS - 100));
		await draw(withD);
		expect(seen.active).toEqual(["a", "b", "c"]);
		expect(seen.pending).toBe(3);
		await act(async () => vi.advanceTimersByTime(100));
		expect(seen).toMatchObject({
			needs: ["c", "a"],
			active: ["b", "d"],
			pending: 0,
		});
	});

	it("holds from what was on screen, not from a render React set aside", async () => {
		let resume = () => {};
		const gate = new Promise<void>((r) => {
			resume = r;
		});
		let waiting = false;
		function Gate() {
			if (waiting) throw gate;
			return null;
		}
		const tree = (model: ThreadListModel) =>
			createElement(
				Suspense,
				{ fallback: null },
				createElement(Probe, { model }),
				createElement(Gate),
			);
		await act(async () => root.render(tree(first)));
		// The new list renders inside a transition that suspends: the screen keeps the first.
		waiting = true;
		await act(async () => startTransition(() => root.render(tree(next))));
		await pointer("pointerenter");
		waiting = false;
		await act(async () => {
			resume();
			await gate;
		});
		await act(async () => root.render(tree(next)));
		expect(seen).toMatchObject({ needs: [], active: ["a", "b"], pending: 1 });
	});
	it("shows the rows the reader asked for (Show more) below the held ones, and holds a new arrival on top", async () => {
		await draw(first);
		await pointer("pointerenter");
		await act(async () => seen.expectMore());
		await draw(paged);
		expect(seen).toMatchObject({
			active: ["a", "b", "old"],
			pending: 1,
		});
	});
});
