// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the store's BATCHED durable-event append (ADR-0018 B.4) —
 * ported from `packages/worker/src/db-investigation-store.test.ts` (0005 §2:
 * through {@link RunPorts} instead of a fetch-based batch poster). Covers:
 * flush at the size threshold, flush on the timer, the terminal (finish/fail)
 * flush draining before the status write, and the best-effort
 * drop-on-failure posture that must never throw.
 */
import type { CanonicalEvent, InvestigationReport } from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import { createPrismaInvestigationStore } from "./prisma-investigation-store.js";
import type { RunPorts } from "./run-ports.js";

const INVESTIGATION_ID = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

/** Flush window (kept in sync with the store's FLUSH_INTERVAL_MS). */
const FLUSH_INTERVAL_MS = 1_000;

const REPORT: InvestigationReport = {
	summary: "summary",
	rootCause: null,
	rootCauseCategory: null,
	hypotheses: [],
	ruledOut: [],
	coverage: { queried: [], notQueried: [] },
	nextSteps: [],
};

/** A minimal canonical event — the store only buffers/forwards it. */
function evt(seq: number, branchId = "branch-1"): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: RUN_ID,
		branchId,
		path: [],
		seq,
		ts: new Date("2026-07-05T00:00:00Z").toISOString(),
		text: "",
		toolCalls: [],
	} as CanonicalEvent;
}

function makePorts(
	appendEvents: (id: string, events: CanonicalEvent[]) => Promise<void>,
	overrides: Partial<RunPorts> = {},
): RunPorts {
	return {
		findInvestigation: vi.fn(async () => null),
		updateStatus: vi.fn(async () => {}),
		appendEvents,
		clearEvents: vi.fn(async () => {}),
		writeResult: vi.fn(async () => {}),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveHarness: vi.fn(async () => ({
			selection: { runnable: true as const, harness: "opencode" as const, auto: true, verified: true },
		})),
		getIncident: vi.fn(async () => null),
		incidentRepos: vi.fn(async () => []),
		repoToken: vi.fn(async () => null),
		ensureClone: vi.fn(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", action: "cloned" as const })),
		...overrides,
	};
}

function makeStore(
	appendEvents: (id: string, events: CanonicalEvent[]) => Promise<void>,
	portOverrides: Partial<RunPorts> = {},
) {
	const ports = makePorts(appendEvents, portOverrides);
	const store = createPrismaInvestigationStore(ports, {
		investigationId: INVESTIGATION_ID,
		incidentId: INCIDENT_ID,
		runId: RUN_ID,
	});
	return { store, ports };
}

/**
 * `InvestigationStore.flush` is optional on the interface (some adapters don't
 * buffer), but `createPrismaInvestigationStore` always provides it. Rather than
 * asserting that away with `!`, verify it as part of the test's arrangement
 * and hand back a narrowed, correctly-typed reference.
 */
function flushOf(store: ReturnType<typeof createPrismaInvestigationStore>) {
	if (!store.flush) {
		throw new Error(
			"createPrismaInvestigationStore's store must provide flush() — got none",
		);
	}
	return store.flush;
}

describe("createPrismaInvestigationStore — batched durable append", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes a full batch as soon as it reaches the size threshold (25)", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		for (let i = 1; i <= 25; i++) {
			await store.append(evt(i));
		}

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][1]).toHaveLength(25);
	});

	it("does not flush a partial batch until the size threshold", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		for (let i = 1; i <= 24; i++) {
			await store.append(evt(i));
		}

		expect(appendEvents).not.toHaveBeenCalled();
	});

	it("flushes a partial batch on the timer when the size threshold is not hit", async () => {
		vi.useFakeTimers();
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		await store.append(evt(3));
		expect(appendEvents).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][1]).toHaveLength(3);
	});

	it("drains buffered events on finish BEFORE writing the result", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const writeResult = vi.fn(async () => {});
		const { store } = makeStore(appendEvents, { writeResult });

		await store.append(evt(1));
		await store.append(evt(2));
		await store.finish(REPORT);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][1]).toHaveLength(2);
		expect(writeResult).toHaveBeenCalledTimes(1);
		// The terminal flush lands before the status/result write.
		expect(appendEvents.mock.invocationCallOrder[0]).toBeLessThan(
			writeResult.mock.invocationCallOrder[0],
		);
	});

	it("drains buffered events on fail BEFORE writing the failed status", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const updateStatus = vi.fn(async () => {});
		const createTimelineEntry = vi.fn(async () => {});
		const { store } = makeStore(appendEvents, { updateStatus, createTimelineEntry });

		await store.append(evt(1));
		await store.fail("boom");

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(updateStatus).toHaveBeenCalledWith(
			INVESTIGATION_ID,
			expect.objectContaining({ status: "failed", error: "boom" }),
		);
		expect(createTimelineEntry).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.invocationCallOrder[0]).toBeLessThan(
			updateStatus.mock.invocationCallOrder[0],
		);
	});

	it("flush() drains the buffered tail synchronously (the conductor's cancelled path)", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		// No size/timer trigger yet — the tail is still buffered.
		expect(appendEvents).not.toHaveBeenCalled();

		await flushOf(store)();

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][1]).toHaveLength(2);
	});

	it("flush() cannot double-send: a pending timer flush and flush() drain the buffer once", async () => {
		vi.useFakeTimers();
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		// flush() takes the whole buffer and cancels the pending timer; the later timer
		// fire finds an empty buffer and is a no-op.
		await flushOf(store)();
		await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][1]).toHaveLength(1);
	});

	it("flush() on an empty buffer is a no-op", async () => {
		const appendEvents = vi.fn(async (_id: string, _events: CanonicalEvent[]) => {});
		const { store } = makeStore(appendEvents);

		await flushOf(store)();

		expect(appendEvents).not.toHaveBeenCalled();
	});

	it("never throws when a flush fails — it logs, drops, and counts the batch", async () => {
		const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		const appendEvents = vi.fn(async () => {
			throw new Error("network down");
		});
		const writeResult = vi.fn(async () => {});
		const { store } = makeStore(appendEvents, { writeResult });

		// A size-triggered flush whose append rejects must not throw out of append.
		for (let i = 1; i <= 25; i++) {
			await expect(store.append(evt(i))).resolves.toBeUndefined();
		}
		expect(appendEvents).toHaveBeenCalledTimes(1);

		// The run still completes: finish resolves and still writes the result.
		await expect(store.finish(REPORT)).resolves.toBeUndefined();
		expect(writeResult).toHaveBeenCalledTimes(1);

		// The drop was logged with a count (per-flush + the terminal total).
		expect(warnSpy).toHaveBeenCalled();
		const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logged).toMatch(/dropped 25 event\(s\)/);

		warnSpy.mockRestore();
	});
});

describe("createPrismaInvestigationStore — lifecycle writes (0005 §2)", () => {
	it("create() writes running status and started timeline through RunPorts", async () => {
		const updateStatus = vi.fn(async () => {});
		const createTimelineEntry = vi.fn(async () => {});
		const { store } = makeStore(vi.fn(async () => {}), {
			updateStatus,
			createTimelineEntry,
		});

		await store.create();

		expect(updateStatus).toHaveBeenCalledWith(INVESTIGATION_ID, {
			status: "running",
			harnessThreadId: RUN_ID,
		});
		expect(createTimelineEntry).toHaveBeenCalledWith({
			incidentId: INCIDENT_ID,
			type: "investigation_started",
			title: "AI Investigation Started",
			description: "Starting the two-tier engine investigation",
			source: "ai_worker",
			metadata: { investigationId: INVESTIGATION_ID },
		});
	});

	it("fail() writes failed status and failure timeline through RunPorts", async () => {
		const updateStatus = vi.fn(async () => {});
		const createTimelineEntry = vi.fn(async () => {});
		const { store } = makeStore(vi.fn(async () => {}), {
			updateStatus,
			createTimelineEntry,
		});

		await store.fail("disk full");

		expect(updateStatus).toHaveBeenCalledWith(INVESTIGATION_ID, {
			status: "failed",
			error: "disk full",
		});
		expect(createTimelineEntry).toHaveBeenCalledWith({
			incidentId: INCIDENT_ID,
			type: "investigation_completed",
			title: "AI Investigation Failed",
			description: "disk full",
			source: "ai_worker",
			metadata: { investigationId: INVESTIGATION_ID, error: "disk full" },
		});
	});
});
