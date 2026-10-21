// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendEvents,
	useInvestigationEventsHistory,
} from "./use-investigation-events";

vi.mock("../orpc-client", async (importOriginal) => {
	const real = await importOriginal<typeof import("../orpc-client")>();
	return {
		...real,
		client: {
			investigations: {
				getEvents: vi.fn(),
			},
		},
	};
});

import { client } from "../orpc-client";

const mockedGetEvents = vi.mocked(client.investigations.getEvents);

function makeStepEvent(
	seq: number,
	branchId: string = "root",
	text: string = `Step ${seq}`,
): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: "run-1",
		branchId,
		path: [],
		seq,
		label: "scout",
		text,
		toolCalls: [],
		ts: `2026-10-21T00:00:0${seq}Z`,
	};
}

function makeReportEvent(
	seq: number,
	summary: string = "Summary",
): CanonicalEvent {
	return {
		kind: "report",
		runId: "00000000-0000-0000-0000-000000000001",
		seq,
		ts: `2026-10-21T00:00:0${seq}Z`,
		report: {
			summary,
			rootCause: null,
			rootCauseCategory: null,
			hypotheses: [],
			ruledOut: [],
			coverage: {
				queried: [],
				notQueried: [],
			},
			nextSteps: [],
		},
	};
}

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("use-investigation-events (#874)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let queryClient: QueryClient;

	beforeEach(() => {
		vi.clearAllMocks();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		queryClient.clear();
		vi.useRealTimers();
	});

	describe("appendEvents", () => {
		it("returns same array back when nothing is new; new events appended in seq order; an event on another branch with a held seq is kept; duplicates dropped", () => {
			const e1 = makeStepEvent(1, "b1");
			const e2 = makeStepEvent(2, "b1");
			const initial = [e1, e2];

			// Same array back when nothing is new
			const unchanged = appendEvents(initial, [e1, e2]);
			expect(unchanged).toBe(initial);

			// New events appended in seq order + duplicates dropped
			const e4 = makeStepEvent(4, "b1");
			const e3 = makeStepEvent(3, "b1");
			const appended = appendEvents(initial, [e4, e3, e2]);
			expect(appended).toEqual([e1, e2, e3, e4]);

			// An event on another branch with a held seq is kept
			const e2BranchB = makeStepEvent(2, "b2");
			const withBranch = appendEvents([e1, e2], [e2BranchB]);
			expect(withBranch).toEqual([e1, e2, e2BranchB]);

			// Report event identity check
			const rep2 = makeReportEvent(2);
			const withReport = appendEvents([e2], [rep2]);
			expect(withReport).toEqual([e2, rep2]);
		});
	});

	describe("useInvestigationEventsHistory", () => {
		it("follows nextCursor across two pages on first read and data holds both pages in order", async () => {
			const page1Events = [makeStepEvent(1), makeStepEvent(2)];
			const page2Events = [makeStepEvent(3), makeStepEvent(4)];

			mockedGetEvents.mockImplementation(async ({ cursor }) => {
				if (cursor === undefined) {
					return {
						events: page1Events,
						nextCursor: 2,
					} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
						infer U
					>
						? U
						: never;
				}
				if (cursor === 2) {
					return {
						events: page2Events,
						nextCursor: null,
					} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
						infer U
					>
						? U
						: never;
				}
				return { events: [], nextCursor: null } as unknown as ReturnType<
					typeof mockedGetEvents
				> extends Promise<infer U>
					? U
					: never;
			});

			let hookResult:
				| ReturnType<typeof useInvestigationEventsHistory>
				| undefined;
			function TestComponent() {
				hookResult = useInvestigationEventsHistory("inv-1");
				return (
					<div>
						{hookResult.data ? `${hookResult.data.length} events` : "loading"}
					</div>
				);
			}

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<TestComponent />
					</QueryClientProvider>,
				);
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(container.textContent).toBe("4 events");
			expect(hookResult?.data).toEqual([...page1Events, ...page2Events]);
			expect(mockedGetEvents).toHaveBeenCalledTimes(2);
			expect(mockedGetEvents).toHaveBeenNthCalledWith(1, {
				id: "inv-1",
				cursor: undefined,
				limit: 200,
			});
			expect(mockedGetEvents).toHaveBeenNthCalledWith(2, {
				id: "inv-1",
				cursor: 2,
				limit: 200,
			});
		});

		it("calls getEvents with cursor: 6 and appends only unseen events after first read ending at seq 7, keeping old events object identity", async () => {
			const initialEvents = [
				makeStepEvent(5),
				makeStepEvent(6),
				makeStepEvent(7),
			];

			mockedGetEvents.mockImplementationOnce(async () => {
				return {
					events: initialEvents,
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			let hookResult:
				| ReturnType<typeof useInvestigationEventsHistory>
				| undefined;
			function TestComponent() {
				hookResult = useInvestigationEventsHistory("inv-1");
				return (
					<div>
						{hookResult.data ? `${hookResult.data.length} events` : "loading"}
					</div>
				);
			}

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<TestComponent />
					</QueryClientProvider>,
				);
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(hookResult?.data).toHaveLength(3);
			const originalE5 = hookResult?.data?.[0];
			const originalE6 = hookResult?.data?.[1];
			const originalE7 = hookResult?.data?.[2];

			const freshE8 = makeStepEvent(8);
			mockedGetEvents.mockImplementationOnce(async ({ cursor }) => {
				expect(cursor).toBe(6);
				// Server re-delivers 7 and fresh 8
				return {
					events: [makeStepEvent(7), freshE8],
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			await act(async () => {
				await hookResult?.catchUp();
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(mockedGetEvents).toHaveBeenCalledTimes(2);
			expect(mockedGetEvents).toHaveBeenLastCalledWith({
				id: "inv-1",
				cursor: 6,
				limit: 200,
			});

			expect(hookResult?.data).toHaveLength(4);
			expect(hookResult?.data?.[0]).toBe(originalE5);
			expect(hookResult?.data?.[1]).toBe(originalE6);
			expect(hookResult?.data?.[2]).toBe(originalE7);
			expect(hookResult?.data?.[3]).toBe(freshE8);
		});

		it("leaves data the same array (toBe) when catchUp returns only already-held events", async () => {
			const initialEvents = [makeStepEvent(1), makeStepEvent(2)];

			mockedGetEvents.mockImplementationOnce(async () => {
				return {
					events: initialEvents,
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			let hookResult:
				| ReturnType<typeof useInvestigationEventsHistory>
				| undefined;
			function TestComponent() {
				hookResult = useInvestigationEventsHistory("inv-1");
				return (
					<div>
						{hookResult.data ? `${hookResult.data.length} events` : "loading"}
					</div>
				);
			}

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<TestComponent />
					</QueryClientProvider>,
				);
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const arrayBeforeCatchUp = hookResult?.data;

			mockedGetEvents.mockImplementationOnce(async () => {
				return {
					events: [makeStepEvent(2)],
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			await act(async () => {
				await hookResult?.catchUp();
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(hookResult?.data).toBe(arrayBeforeCatchUp);
		});

		it("calls getEvents 3 more times with cursor when pollMs is 3000 and advances 9000ms, and calls nothing more with pollMs: false", async () => {
			vi.useFakeTimers();

			const initialEvents = [makeStepEvent(5)];
			mockedGetEvents.mockImplementation(async () => {
				return {
					events: initialEvents,
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			function PollingComponent({ pollMs }: { pollMs?: number | false }) {
				useInvestigationEventsHistory("inv-1", { pollMs });
				return null;
			}

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<PollingComponent pollMs={3000} />
					</QueryClientProvider>,
				);
			});

			// Initial read done
			expect(mockedGetEvents).toHaveBeenCalledTimes(1);
			expect(mockedGetEvents).toHaveBeenLastCalledWith({
				id: "inv-1",
				cursor: undefined,
				limit: 200,
			});

			// Advance 9000 ms -> 3 intervals
			await act(async () => {
				await vi.advanceTimersByTimeAsync(9000);
			});

			expect(mockedGetEvents).toHaveBeenCalledTimes(4);
			for (let i = 2; i <= 4; i++) {
				expect(mockedGetEvents).toHaveBeenNthCalledWith(i, {
					id: "inv-1",
					cursor: 4,
					limit: 200,
				});
			}

			// Clean up and test with pollMs: false
			await act(async () => {
				root.unmount();
			});
			container = document.createElement("div");
			document.body.appendChild(container);
			root = createRoot(container);
			mockedGetEvents.mockClear();

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<PollingComponent pollMs={false} />
					</QueryClientProvider>,
				);
			});

			expect(mockedGetEvents).toHaveBeenCalledTimes(0); // data is already in cache (staleTime Infinity)

			await act(async () => {
				await vi.advanceTimersByTimeAsync(9000);
			});

			expect(mockedGetEvents).toHaveBeenCalledTimes(0);
		});

		it("does not refetch on window focus or remount within the same QueryClient (staleTime is Infinity)", async () => {
			const initialEvents = [makeStepEvent(1)];
			mockedGetEvents.mockImplementationOnce(async () => {
				return {
					events: initialEvents,
					nextCursor: null,
				} as unknown as ReturnType<typeof mockedGetEvents> extends Promise<
					infer U
				>
					? U
					: never;
			});

			function TestComponent() {
				const { data } = useInvestigationEventsHistory("inv-1");
				return <div>{data ? `${data.length} events` : "loading"}</div>;
			}

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<TestComponent />
					</QueryClientProvider>,
				);
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(container.textContent).toBe("1 events");
			expect(mockedGetEvents).toHaveBeenCalledTimes(1);

			// Unmount
			await act(async () => {
				root.unmount();
			});

			// Remount into new container
			container = document.createElement("div");
			document.body.appendChild(container);
			root = createRoot(container);

			await act(async () => {
				root.render(
					<QueryClientProvider client={queryClient}>
						<TestComponent />
					</QueryClientProvider>,
				);
			});

			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(container.textContent).toBe("1 events");
			expect(mockedGetEvents).toHaveBeenCalledTimes(1);
		});
	});
});
