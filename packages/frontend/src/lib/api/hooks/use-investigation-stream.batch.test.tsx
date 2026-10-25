// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyEvents,
	useInvestigationStream,
} from "./use-investigation-stream";

class MockEventSource {
	static instances: MockEventSource[] = [];

	url: string;
	readyState = 0;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	closed = false;

	constructor(url: string) {
		this.url = url;
		this.readyState = 1;
		MockEventSource.instances.push(this);
	}

	close() {
		this.closed = true;
		this.readyState = 2;
	}

	deliver(data: unknown) {
		this.onmessage?.({ data: JSON.stringify(data) });
	}

	deliverRaw(raw: string) {
		this.onmessage?.({ data: raw });
	}

	triggerError() {
		this.onerror?.(new Event("error"));
	}
}

(
	globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgentStep(seq: number, text = `step ${seq}`): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: "run-1",
		branchId: "root",
		path: [],
		seq,
		label: "agent",
		text,
		toolCalls: [],
		ts: "2026-10-21T00:00:00Z",
	};
}

describe("useInvestigationStream batching (#874)", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers({
			toFake: [
				"requestAnimationFrame",
				"cancelAnimationFrame",
				"setTimeout",
				"clearTimeout",
			],
		});
		MockEventSource.instances = [];
		vi.stubGlobal("EventSource", MockEventSource);

		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("delivers 50 agent_step events in one synchronous loop with exactly one commit per frame", async () => {
		const commitEventLengths: number[] = [];

		function TestComponent() {
			const state = useInvestigationStream("inv-1", { enabled: true });
			useEffect(() => {
				commitEventLengths.push(state.events.length);
			});
			return null;
		}

		await act(async () => {
			root.render(<TestComponent />);
		});

		expect(MockEventSource.instances).toHaveLength(1);
		const source = MockEventSource.instances[0];

		const commitsBefore = commitEventLengths.length;

		await act(async () => {
			for (let i = 0; i < 50; i++) {
				source.deliver(makeAgentStep(i));
			}
			vi.advanceTimersToNextFrame();
		});

		// Exactly one new commit occurred, having all 50 events in order
		expect(commitEventLengths.slice(commitsBefore)).toEqual([50]);
		expect(commitEventLengths[commitEventLengths.length - 1]).toBe(50);
	});

	it("does not apply queued events before the animation frame", async () => {
		const commitEventLengths: number[] = [];

		function TestComponent() {
			const state = useInvestigationStream("inv-1", { enabled: true });
			useEffect(() => {
				commitEventLengths.push(state.events.length);
			});
			return null;
		}

		await act(async () => {
			root.render(<TestComponent />);
		});

		const source = MockEventSource.instances[0];

		await act(async () => {
			for (let i = 0; i < 50; i++) {
				source.deliver(makeAgentStep(i));
			}
			// Before advancing timers, no commit has processed the queued events
			expect(commitEventLengths[commitEventLengths.length - 1]).toBe(0);
			vi.advanceTimersToNextFrame();
		});

		expect(commitEventLengths[commitEventLengths.length - 1]).toBe(50);
	});

	it("applies queued events via hidden tab timer without advancing frames", async () => {
		const commitEventLengths: number[] = [];

		function TestComponent() {
			const state = useInvestigationStream("inv-1", { enabled: true });
			useEffect(() => {
				commitEventLengths.push(state.events.length);
			});
			return null;
		}

		await act(async () => {
			root.render(<TestComponent />);
		});

		const source = MockEventSource.instances[0];
		const commitsBefore = commitEventLengths.length;

		await act(async () => {
			for (let i = 0; i < 5; i++) {
				source.deliver(makeAgentStep(i));
			}
			expect(commitEventLengths[commitEventLengths.length - 1]).toBe(0);
			vi.advanceTimersByTime(100);
		});

		expect(commitEventLengths.slice(commitsBefore)).toEqual([5]);
	});

	it("flushes queue first on done marker: completed status or failed when an error occurred", async () => {
		let latestState: ReturnType<typeof useInvestigationStream> | undefined;

		function TestComponent() {
			const state = useInvestigationStream("inv-1", { enabled: true });
			latestState = state;
			return null;
		}

		await act(async () => {
			root.render(<TestComponent />);
		});

		const source1 = MockEventSource.instances[0];

		// Clean run: 3 events + done
		await act(async () => {
			source1.deliver(makeAgentStep(0));
			source1.deliver(makeAgentStep(1));
			source1.deliver(makeAgentStep(2));
			source1.deliver({ type: "done" });
		});

		expect(latestState?.events).toHaveLength(3);
		expect(latestState?.events.map((e) => e.seq)).toEqual([0, 1, 2]);
		expect(latestState?.status).toBe("completed");
		expect(source1.closed).toBe(true);

		// Run with error event: status becomes failed on done
		await act(async () => {
			root.render(<TestComponent key="remount" />);
		});

		const source2 = MockEventSource.instances[1];
		const errorEvent: CanonicalEvent = {
			kind: "error",
			runId: "run-1",
			branchId: "root",
			path: [],
			seq: 1,
			label: null,
			message: "something failed",
			ts: "2026-10-21T00:00:01Z",
		};

		await act(async () => {
			source2.deliver(makeAgentStep(0));
			source2.deliver(errorEvent);
			source2.deliver(makeAgentStep(2));
			source2.deliver({ type: "done" });
		});

		expect(latestState?.events).toHaveLength(3);
		expect(latestState?.status).toBe("failed");
		expect(source2.closed).toBe(true);
	});

	it("flushes queue first on onerror and sets status to error", async () => {
		let latestState: ReturnType<typeof useInvestigationStream> | undefined;

		function TestComponent() {
			const state = useInvestigationStream("inv-1", { enabled: true });
			latestState = state;
			return null;
		}

		await act(async () => {
			root.render(<TestComponent />);
		});

		const source = MockEventSource.instances[0];

		await act(async () => {
			source.deliver(makeAgentStep(0));
			source.deliver(makeAgentStep(1));
			source.triggerError();
		});

		expect(latestState?.events).toHaveLength(2);
		expect(latestState?.events.map((e) => e.seq)).toEqual([0, 1]);
		expect(latestState?.status).toBe("error");
		expect(source.closed).toBe(true);
	});

	describe("applyEvents pure function", () => {
		it("sets completed after report, tracks latestText from agent_step, and keeps prev events in front", () => {
			const prevEvents: CanonicalEvent[] = [
				makeAgentStep(0, "Initial thought"),
			];
			const prevState = {
				events: prevEvents,
				status: "streaming" as const,
				latestText: "Initial thought",
			};

			const batch: CanonicalEvent[] = [
				makeAgentStep(1, "Updated thinking"),
				{
					kind: "report",
					runId: "00000000-0000-0000-0000-000000000001",
					seq: 2,
					ts: "2026-10-21T00:00:02Z",
					report: {
						summary: "Report summary",
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
				},
			];

			const nextState = applyEvents(prevState, batch);

			expect(nextState.events).toEqual([...prevEvents, ...batch]);
			expect(nextState.status).toBe("completed");
			expect(nextState.latestText).toBe("Updated thinking");
		});
	});
});
