// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SettledState } from "@prismalens/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type SettleCall,
	type SettleUndo,
	UNDO_MS,
	useSettleUndo,
} from "./use-settle-undo";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const prev: SettledState[] = [{ id: "t1", settledAt: null }];
const row = { id: "t1", title: "Pool", kind: "chat" } as never;

let calls: SettleCall[];
let hook: SettleUndo;
let container: HTMLDivElement;
let root: Root;

function Probe() {
	hook = useSettleUndo((vars, opts) => calls.push({ vars, opts }));
	return null;
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	calls = [];
	container = document.createElement("div");
	root = createRoot(container);
	await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
	await act(async () => root.unmount());
	vi.useRealTimers();
});

describe("Settle and Undo on the thread list (#1020)", () => {
	it("a second Settle on the same row is ignored while its Undo is offered", async () => {
		await act(async () => hook.settle(row));
		await act(async () =>
			calls[0]?.opts.onSuccess?.({ ids: ["t1"], previous: prev }),
		);
		await act(async () => hook.settle(row));
		expect(calls).toHaveLength(1);
		expect(hook.undo?.previous).toBe(prev);
	});

	it("the Undo window starts when the previous states arrive, not at the click", async () => {
		await act(async () => hook.settle(row));
		await act(async () => vi.advanceTimersByTime(UNDO_MS + 1000));
		expect(hook.undo?.id).toBe("t1");
		await act(async () =>
			calls[0]?.opts.onSuccess?.({ ids: ["t1"], previous: prev }),
		);
		await act(async () => vi.advanceTimersByTime(UNDO_MS - 100));
		expect(hook.undo?.previous).toBe(prev);
		await act(async () => vi.advanceTimersByTime(200));
		expect(hook.undo).toBeNull();
	});

	it("a failed Settle drops its Undo line", async () => {
		await act(async () => hook.settle(row));
		await act(async () => calls[0]?.opts.onError?.(new Error("x")));
		expect(hook.undo).toBeNull();
	});

	it("a failed Undo keeps the previous states for a retry; a good one clears them", async () => {
		await act(async () => hook.settle(row));
		await act(async () =>
			calls[0]?.opts.onSuccess?.({ ids: ["t1"], previous: prev }),
		);
		await act(async () => hook.restore());
		expect(calls[1]?.vars).toEqual({ id: "t1", settled: false, restore: prev });
		await act(async () => calls[1]?.opts.onError?.(new Error("x")));
		expect(hook.undo?.previous).toBe(prev);
		expect(hook.undo?.restoring).toBe(false);
		await act(async () => hook.restore());
		await act(async () =>
			calls[2]?.opts.onSuccess?.({ ids: ["t1"], previous: [] }),
		);
		expect(hook.undo).toBeNull();
	});

	it("when the settle response carries undoUntil 20 s ahead, the undo entry is still there after 8 s and gone after 20 s (#1024)", async () => {
		const undoUntil = new Date(Date.now() + 20_000).toISOString();
		await act(async () => hook.settle(row));
		await act(async () =>
			calls[0]?.opts.onSuccess?.({ ids: ["t1"], previous: prev, undoUntil }),
		);
		await act(async () => vi.advanceTimersByTime(8000));
		expect(hook.undo?.previous).toBe(prev);
		await act(async () => vi.advanceTimersByTime(12000));
		expect(hook.undo).toBeNull();
	});
});
