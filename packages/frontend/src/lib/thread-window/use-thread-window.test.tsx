// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, OpenThread } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadWindow } from "./use-thread-window";

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

import { client } from "@/lib/api/orpc-client";

const mockedOpenWindow = vi.mocked(client.investigations.openWindow);
const mockedGetEvents = vi.mocked(client.investigations.getEvents);
const mockedWindowPage = vi.mocked(client.investigations.windowPage);
const mockedWindowIndex = vi.mocked(client.investigations.windowIndex);

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderHook<T>(hook: () => T, queryClient: QueryClient) {
	const result = { current: undefined as unknown as T };
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	function HookHarness() {
		result.current = hook();
		return null;
	}

	act(() => {
		root.render(
			<QueryClientProvider client={queryClient}>
				<HookHarness />
			</QueryClientProvider>,
		);
	});

	return {
		result,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

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

	addEventListener() {}
	removeEventListener() {}
	close() {
		this.readyState = 2;
	}
}

describe("useThreadWindow", () => {
	let queryClient: QueryClient;
	const originalEventSource = globalThis.EventSource;

	beforeEach(() => {
		vi.clearAllMocks();
		MockEventSource.instances = [];
		globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
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

		const { result } = renderHook(
			() => useThreadWindow("t1", { enabled: true, live: false }),
			queryClient,
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

		renderHook(
			() => useThreadWindow("t1", { enabled: true, live: false }),
			queryClient,
		);

		await vi.waitFor(() => {
			expect(mockedOpenWindow).toHaveBeenCalledTimes(1);
		});

		expect(MockEventSource.instances).toHaveLength(0);
	});
});
