// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, OpenThread } from "@prismalens/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithAppSync as renderHook } from "@/test/render";
import { APPEND_MIN_MS, paced, useThreadWindow } from "./use-thread-window";
import type { WindowChange } from "./window-store";

vi.mock("@/lib/api/orpc-client", () => ({
	client: {
		investigations: {
			getEvents: vi.fn(),
			openWindow: vi.fn(),
			windowPage: vi.fn(),
			windowIndex: vi.fn(),
		},
	},
}));

// The schemas chunk loads when a test says so, as on a slow link (#1193 bar 16.12).
const schemasLoad = vi.hoisted(() => ({
	ready: null as unknown,
	pending: null as Promise<unknown> | null,
	release: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/thread-schemas-load", async (actual) => {
	const real = await actual<typeof import("@/lib/thread-schemas-load")>();
	return {
		...real,
		threadSchemas: () => schemasLoad.ready,
		loadThreadSchemas: () => {
			schemasLoad.pending ??= new Promise((resolve) => {
				schemasLoad.release = async () => {
					schemasLoad.ready = await import("@/lib/thread-schemas");
					resolve(schemasLoad.ready);
				};
			});
			return schemasLoad.pending;
		},
	};
});

import { client } from "@/lib/api/orpc-client";

const mockedOpenWindow = vi.mocked(client.investigations.openWindow);
const mockedGetEvents = vi.mocked(client.investigations.getEvents);
const mockedWindowPage = vi.mocked(client.investigations.windowPage);
const mockedWindowIndex = vi.mocked(client.investigations.windowIndex);

function makeStepEvent(seq: number): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: "run-1",
		branchId: "main",
		path: [],
		seq,
		label: null,
		text: `Step ${seq}`,
		toolCalls: [],
		ts: "2026-11-12T00:00:00Z",
	};
}

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	readyState = 0;

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	listeners = new Map<string, (m: { data: string }) => void>();
	addEventListener(name: string, fn: (m: { data: string }) => void) {
		this.listeners.set(name, fn);
	}
	emit(name: string, data: unknown) {
		this.listeners.get(name)?.({ data: JSON.stringify(data) });
	}
	removeEventListener() {}
	close() {
		this.readyState = 2;
	}
}

describe("useThreadWindow", () => {
	const originalEventSource = globalThis.EventSource;

	beforeEach(() => {
		vi.clearAllMocks();
		MockEventSource.instances = [];
		schemasLoad.ready = null;
		schemasLoad.pending = null;
		schemasLoad.release = null;
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
	});

	afterEach(() => {
		globalThis.EventSource = originalEventSource;
	});

	it('useThreadWindow("t1", {enabled: true, live: false}) with openWindow resolving to a minimal OpenThread: gen: 0 and revision: 2; an index with no turns or entries, total: 0 and lost: 0; a page holding two items, main:0 and main:1; a state with empty arrays. That open makes exactly 1 openWindow call, 0 getEvents calls, 0 windowPage calls and 0 windowIndex calls. result.current.items.map(i => i.key) equals ["main:0", "main:1"].', async () => {
		const e0 = makeStepEvent(0);
		const e1 = makeStepEvent(1);

		const minimalOpen: OpenThread = {
			gen: 0,
			revision: 2,
			index: {
				gen: 0,
				revision: 2,
				total: 0,
				lost: 0,
				turns: [],
				entries: [],
			},
			page: {
				gen: 0,
				revision: 2,
				lo: "main:0",
				hi: "main:1",
				hasBefore: false,
				hasAfter: false,
				items: [
					{ key: "main:0", ordinal: 0, event: e0 },
					{ key: "main:1", ordinal: 1, event: e1 },
				],
				context: {
					stepsBefore: 0,
					endsBefore: 0,
					operatorsBefore: 0,
					agentBefore: false,
				},
				folded: [],
				target: null,
			},
			state: {
				openAsks: [],
				queue: [],
				hypotheses: [],
			},
			landing: null,
		};

		mockedOpenWindow.mockResolvedValueOnce(minimalOpen);

		const { result } = renderHook(() =>
			useThreadWindow("t1", { enabled: true, live: false }),
		);

		await vi.waitFor(() => {
			expect(result.current.items.map((i) => i.key)).toEqual([
				"main:0",
				"main:1",
			]);
		});

		expect(mockedOpenWindow).toHaveBeenCalledTimes(1);
		expect(mockedOpenWindow).toHaveBeenCalledWith({
			id: "t1",
			fold: true,
		});
		expect(mockedGetEvents).toHaveBeenCalledTimes(0);
		expect(mockedWindowPage).toHaveBeenCalledTimes(0);
		expect(mockedWindowIndex).toHaveBeenCalledTimes(0);
	});

	it("stub EventSource on globalThis with a class that records constructions, so no real stream opens. With live: false, no EventSource is constructed.", async () => {
		const minimalOpen: OpenThread = {
			gen: 0,
			revision: 2,
			index: {
				gen: 0,
				revision: 2,
				total: 0,
				lost: 0,
				turns: [],
				entries: [],
			},
			page: {
				gen: 0,
				revision: 2,
				lo: null,
				hi: null,
				hasBefore: false,
				hasAfter: false,
				items: [],
				context: {
					stepsBefore: 0,
					endsBefore: 0,
					operatorsBefore: 0,
					agentBefore: false,
				},
				folded: [],
				target: null,
			},
			state: {
				openAsks: [],
				queue: [],
				hypotheses: [],
			},
			landing: null,
		};

		mockedOpenWindow.mockResolvedValueOnce(minimalOpen);

		renderHook(() => useThreadWindow("t1", { enabled: true, live: false }));

		await vi.waitFor(() => {
			expect(mockedOpenWindow).toHaveBeenCalledTimes(1);
		});

		expect(MockEventSource.instances).toHaveLength(0);
	});

	it("an ended thread's catch-up keeps a commit that arrived before its done frame while the schemas loaded (#1193 bar 16.12)", async () => {
		const e0 = makeStepEvent(0);
		mockedOpenWindow.mockResolvedValueOnce({
			gen: 0,
			revision: 2,
			index: { gen: 0, revision: 2, total: 0, lost: 0, turns: [], entries: [] },
			page: {
				gen: 0,
				revision: 2,
				lo: "main:0",
				hi: "main:0",
				hasBefore: false,
				hasAfter: false,
				items: [{ key: "main:0", ordinal: 0, event: e0 }],
				context: {
					stepsBefore: 0,
					endsBefore: 0,
					operatorsBefore: 0,
					agentBefore: false,
				},
				folded: [],
				target: null,
			},
			state: { openAsks: [], queue: [], hypotheses: [] },
			landing: null,
		});
		const { result } = renderHook(() =>
			useThreadWindow("t1", { enabled: true, live: false }),
		);
		await vi.waitFor(() =>
			expect(result.current.items.map((i) => i.key)).toEqual(["main:0"]),
		);

		act(() => result.current.pull());
		await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
		const es = MockEventSource.instances[0]!;
		act(() => {
			es.emit("commit", {
				gen: 0,
				through: 3,
				// A frame parses as the server sends it: a real run id.
				events: [
					{
						ordinal: 2,
						event: {
							...makeStepEvent(2),
							runId: "6ef16e05-6fe1-4e41-b7ad-054860c22368",
						},
					},
				],
				acks: [],
			});
			es.emit("done", { gen: 0, through: 3, lost: 0 });
		});
		await act(async () => schemasLoad.release?.());

		await vi.waitFor(() =>
			expect(result.current.items.map((i) => i.key)).toEqual([
				"main:0",
				"main:2",
			]),
		);
	});
	it("with a live stream, setting document.visibilityState to hidden and dispatching visibilitychange closes EventSource after 5 s (not before); visible again reopens with same after= cursor", async () => {
		const e0 = makeStepEvent(0);
		const minimalOpen: OpenThread = {
			gen: 0,
			revision: 2,
			index: { gen: 0, revision: 2, total: 0, lost: 0, turns: [], entries: [] },
			page: {
				gen: 0,
				revision: 2,
				lo: "main:0",
				hi: "main:0",
				hasBefore: false,
				hasAfter: false,
				items: [{ key: "main:0", ordinal: 0, event: e0 }],
				context: {
					stepsBefore: 0,
					endsBefore: 0,
					operatorsBefore: 0,
					agentBefore: false,
				},
				folded: [],
				target: null,
			},
			state: { openAsks: [], queue: [], hypotheses: [] },
			landing: null,
		};
		mockedOpenWindow.mockResolvedValueOnce(minimalOpen);

		const { unmount } = renderHook(() =>
			useThreadWindow("t1", { enabled: true, live: true }),
		);

		await vi.waitFor(() => {
			expect(MockEventSource.instances).toHaveLength(1);
		});

		const firstES = MockEventSource.instances[0]!;
		expect(firstES.readyState).toBe(0);
		const initialUrl = firstES.url;
		expect(initialUrl).toContain("after=0.");

		vi.useFakeTimers();
		try {
			Object.defineProperty(document, "visibilityState", {
				value: "hidden",
				writable: true,
				configurable: true,
			});
			act(() => {
				document.dispatchEvent(new Event("visibilitychange"));
			});

			act(() => {
				vi.advanceTimersByTime(4900);
			});
			expect(firstES.readyState).toBe(0);

			act(() => {
				vi.advanceTimersByTime(200);
			});
			expect(firstES.readyState).toBe(2);

			Object.defineProperty(document, "visibilityState", {
				value: "visible",
				writable: true,
				configurable: true,
			});
			act(() => {
				document.dispatchEvent(new Event("visibilitychange"));
			});

			expect(MockEventSource.instances).toHaveLength(2);
			const secondES = MockEventSource.instances[1]!;
			expect(secondES.readyState).toBe(0);
			expect(secondES.url).toBe(initialUrl);
		} finally {
			vi.useRealTimers();
			Object.defineProperty(document, "visibilityState", {
				value: "visible",
				writable: true,
				configurable: true,
			});
			unmount();
		}
	});
});

describe("paced(store) (#1181)", () => {
	it("notifies a non-append change at once, synchronously", () => {
		let listener: (() => void) | undefined;
		let change: WindowChange = "replace";
		const store = {
			get change() {
				return change;
			},
			subscribe: (fn: () => void) => {
				listener = fn;
				return () => {
					listener = undefined;
				};
			},
		};
		const notify = vi.fn();
		const unsubscribe = paced(store)(notify);

		change = "update";
		listener?.();
		expect(notify).toHaveBeenCalledTimes(1);

		change = "prepend";
		listener?.();
		expect(notify).toHaveBeenCalledTimes(2);

		unsubscribe();
	});

	it("coalesces several append changes in a row to notify once", () => {
		vi.useFakeTimers();
		try {
			let listener: (() => void) | undefined;
			const store = {
				change: "append" as WindowChange,
				subscribe: (fn: () => void) => {
					listener = fn;
					return () => {
						listener = undefined;
					};
				},
			};
			const notify = vi.fn();
			const unsubscribe = paced(store)(notify);

			listener?.();
			listener?.();
			listener?.();
			expect(notify).toHaveBeenCalledTimes(0);

			vi.runAllTimers();
			expect(notify).toHaveBeenCalledTimes(1);

			unsubscribe();
		} finally {
			vi.useRealTimers();
		}
	});

	it("after a notify whose render took T ms, the next append notify waits max(APPEND_MIN_MS, 2*T)", () => {
		vi.useFakeTimers();
		try {
			let listener: (() => void) | undefined;
			const store = {
				change: "append" as WindowChange,
				subscribe: (fn: () => void) => {
					listener = fn;
					return () => {
						listener = undefined;
					};
				},
			};
			const notify = vi.fn();
			const unsubscribe = paced(store)(notify);

			let now = 1000;
			const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);

			listener?.();
			expect(notify).toHaveBeenCalledTimes(0);
			vi.advanceTimersByTime(0);
			expect(notify).toHaveBeenCalledTimes(1);

			expect(APPEND_MIN_MS).toBe(16);

			// Render took T = 20 ms, which exceeds APPEND_MIN_MS = 16
			now = 1020;
			vi.advanceTimersByTime(1);

			// Next append at now = 1020; nextAt = 1020 + max(16, 2 * 20) = 1060
			listener?.();
			expect(notify).toHaveBeenCalledTimes(1);

			now = 1059;
			vi.advanceTimersByTime(38);
			expect(notify).toHaveBeenCalledTimes(1);

			now = 1060;
			vi.advanceTimersByTime(2);
			expect(notify).toHaveBeenCalledTimes(2);

			// Render took T = 5 ms, where APPEND_MIN_MS (16 ms) exceeds 2*T (10 ms)
			now = 1065;
			vi.advanceTimersByTime(1);

			// Next append at now = 1065; wait is max(APPEND_MIN_MS, 2*5) = 16 ms
			listener?.();
			expect(notify).toHaveBeenCalledTimes(2);

			now = 1080;
			vi.advanceTimersByTime(14);
			expect(notify).toHaveBeenCalledTimes(2);

			now = 1081;
			vi.advanceTimersByTime(2);
			expect(notify).toHaveBeenCalledTimes(3);

			nowSpy.mockRestore();
			unsubscribe();
		} finally {
			vi.useRealTimers();
		}
	});

	it("a non-append change while an append is waiting notifies at once and cancels the wait", () => {
		vi.useFakeTimers();
		try {
			let listener: (() => void) | undefined;
			let change: WindowChange = "append";
			const store = {
				get change() {
					return change;
				},
				subscribe: (fn: () => void) => {
					listener = fn;
					return () => {
						listener = undefined;
					};
				},
			};
			const notify = vi.fn();
			const unsubscribe = paced(store)(notify);

			change = "append";
			listener?.();
			expect(notify).toHaveBeenCalledTimes(0);

			change = "replace";
			listener?.();
			expect(notify).toHaveBeenCalledTimes(1);

			vi.runAllTimers();
			expect(notify).toHaveBeenCalledTimes(1);

			unsubscribe();
		} finally {
			vi.useRealTimers();
		}
	});

	it("unsubscribe clears a pending timer", () => {
		vi.useFakeTimers();
		try {
			let listener: (() => void) | undefined;
			const store = {
				change: "append" as WindowChange,
				subscribe: (fn: () => void) => {
					listener = fn;
					return () => {
						listener = undefined;
					};
				},
			};
			const notify = vi.fn();
			const unsubscribe = paced(store)(notify);

			listener?.();
			expect(notify).toHaveBeenCalledTimes(0);

			unsubscribe();
			vi.runAllTimers();
			expect(notify).toHaveBeenCalledTimes(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
