// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadWindowEvents } from "@/lib/thread-window/window-events-context";
import { useInvestigationEventsHistory } from "./use-investigation-events";

vi.mock("../orpc-client", () => ({
	client: {
		investigations: {
			getEvents: vi.fn(),
		},
	},
	orpc: {
		investigations: {
			getEvents: {
				key: ({ input }: { input: { id: string } }) => [
					"investigations",
					"getEvents",
					input.id,
				],
			},
		},
	},
}));

import { client } from "../orpc-client";

const mockedGetEvents = vi.mocked(client.investigations.getEvents);

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderHook<T>(
	hook: () => T,
	queryClient: QueryClient,
	wrapper?: ({ children }: { children: ReactNode }) => ReactNode,
) {
	const result = { current: undefined as unknown as T };
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	function HookHarness() {
		result.current = hook();
		return null;
	}

	act(() => {
		const content = <HookHarness />;
		root.render(
			<QueryClientProvider client={queryClient}>
				{wrapper ? wrapper({ children: content }) : content}
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

function makeEvent(seq: number, branchId: string = "main"): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: "run-1",
		branchId,
		path: [],
		seq,
		label: null,
		text: `Step ${seq}`,
		toolCalls: [],
		ts: "2026-11-12T00:00:00Z",
	};
}

describe("useInvestigationEventsHistory", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
	});

	it("with no provider, the hook pages through getEvents until nextCursor is null. Use three pages of one event each. It makes exactly 3 calls, and data holds the 3 events in order.", async () => {
		const e1 = makeEvent(1);
		const e2 = makeEvent(2);
		const e3 = makeEvent(3);

		mockedGetEvents.mockImplementation(async ({ cursor }) => {
			if (cursor === undefined) {
				return { events: [e1], nextCursor: 1 };
			}
			if (cursor === 1) {
				return { events: [e2], nextCursor: 2 };
			}
			if (cursor === 2) {
				return { events: [e3], nextCursor: null };
			}
			return { events: [], nextCursor: null };
		});

		const { result } = renderHook(
			() => useInvestigationEventsHistory("t1"),
			queryClient,
		);

		await vi.waitFor(() => {
			expect(result.current.data).toEqual([e1, e2, e3]);
		});

		expect(mockedGetEvents).toHaveBeenCalledTimes(3);
		expect(mockedGetEvents).toHaveBeenNthCalledWith(1, {
			id: "t1",
			cursor: undefined,
			limit: 200,
		});
		expect(mockedGetEvents).toHaveBeenNthCalledWith(2, {
			id: "t1",
			cursor: 1,
			limit: 200,
		});
		expect(mockedGetEvents).toHaveBeenNthCalledWith(3, {
			id: "t1",
			cursor: 2,
			limit: 200,
		});
	});

	it('inside ThreadWindowEvents.Provider with value {threadId: "t1", events: [e1, e2]}, calling the hook for "t1" makes 0 getEvents calls, and data is [e1, e2]. Await a few ticks before counting, with waitFor on something that resolves.', async () => {
		const e1 = makeEvent(1);
		const e2 = makeEvent(2);

		const wrapper = ({ children }: { children: ReactNode }) => (
			<ThreadWindowEvents.Provider value={{ threadId: "t1", events: [e1, e2] }}>
				{children}
			</ThreadWindowEvents.Provider>
		);

		const { result } = renderHook(
			() => useInvestigationEventsHistory("t1"),
			queryClient,
			wrapper,
		);

		await vi.waitFor(() => {
			expect(result.current.data).toEqual([e1, e2]);
		});

		expect(mockedGetEvents).toHaveBeenCalledTimes(0);
	});

	it('inside the same provider, calling the hook for another id "t2" still fetches. It makes 1 call when the first page has nextCursor null.', async () => {
		const e1 = makeEvent(1);
		const e2 = makeEvent(2);
		const eOther = makeEvent(10);

		mockedGetEvents.mockResolvedValueOnce({
			events: [eOther],
			nextCursor: null,
		});

		const wrapper = ({ children }: { children: ReactNode }) => (
			<ThreadWindowEvents.Provider value={{ threadId: "t1", events: [e1, e2] }}>
				{children}
			</ThreadWindowEvents.Provider>
		);

		const { result } = renderHook(
			() => useInvestigationEventsHistory("t2"),
			queryClient,
			wrapper,
		);

		await vi.waitFor(() => {
			expect(result.current.data).toEqual([eOther]);
		});

		expect(mockedGetEvents).toHaveBeenCalledTimes(1);
		expect(mockedGetEvents).toHaveBeenNthCalledWith(1, {
			id: "t2",
			cursor: undefined,
			limit: 200,
		});
	});

	it('inside the provider, catchUp() for "t1" makes 0 calls.', async () => {
		const e1 = makeEvent(1);
		const e2 = makeEvent(2);

		const wrapper = ({ children }: { children: ReactNode }) => (
			<ThreadWindowEvents.Provider value={{ threadId: "t1", events: [e1, e2] }}>
				{children}
			</ThreadWindowEvents.Provider>
		);

		const { result } = renderHook(
			() => useInvestigationEventsHistory("t1"),
			queryClient,
			wrapper,
		);

		await vi.waitFor(() => {
			expect(result.current.data).toEqual([e1, e2]);
		});

		await act(async () => {
			await result.current.catchUp();
		});

		expect(mockedGetEvents).toHaveBeenCalledTimes(0);
	});
});
