/**
 * Hermetic tests for the DB investigation store's BATCHED durable-event append
 * (ADR-0018 B.4). No network: the batch poster is injected (`appendEvents`) and the
 * orpc `api` client is a mock. Covers: flush at the size threshold, flush on the
 * timer, the terminal (finish/fail) flush draining before the status write, and the
 * best-effort drop-on-failure posture that must never throw.
 */
import type { ContractRouterClient } from "@orpc/contract";
import type {
	CanonicalEvent,
	Contract,
	InvestigationReport,
} from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbInvestigationStore } from "./db-investigation-store.js";

const INVESTIGATION_ID = "11111111-1111-1111-1111-111111111111";
const INCIDENT_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

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

/** An orpc `api` double covering exactly the lifecycle calls the store makes. */
function makeApi() {
	return {
		investigations: {
			updateStatus: vi.fn().mockResolvedValue({}),
			writeResult: vi.fn().mockResolvedValue({}),
		},
		timeline: {
			create: vi.fn().mockResolvedValue({}),
		},
	} as unknown as ContractRouterClient<Contract>;
}

function makeStore(
	appendEvents: (events: CanonicalEvent[]) => Promise<void>,
	api = makeApi(),
) {
	const store = createDbInvestigationStore(api, {
		investigationId: INVESTIGATION_ID,
		incidentId: INCIDENT_ID,
		runId: RUN_ID,
		apiBaseUrl: "http://api.test",
		internalSecret: "test-secret",
		appendEvents,
	});
	return { store, api };
}

describe("createDbInvestigationStore — batched durable append", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes a full batch as soon as it reaches the size threshold (25)", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		for (let i = 1; i <= 25; i++) {
			await store.append(evt(i));
		}

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(25);
	});

	it("does not flush a partial batch until the size threshold", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		for (let i = 1; i <= 24; i++) {
			await store.append(evt(i));
		}

		expect(appendEvents).not.toHaveBeenCalled();
	});

	it("flushes a partial batch on the timer when the size threshold is not hit", async () => {
		vi.useFakeTimers();
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		await store.append(evt(3));
		expect(appendEvents).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(3);
	});

	it("drains buffered events on finish BEFORE writing the result", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store, api } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		await store.finish(REPORT);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(2);
		expect(api.investigations.writeResult).toHaveBeenCalledTimes(1);
		// The terminal flush lands before the status/result write.
		expect(appendEvents.mock.invocationCallOrder[0]).toBeLessThan(
			(api.investigations.writeResult as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0],
		);
	});

	it("drains buffered events on fail BEFORE writing the failed status", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store, api } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.fail("boom");

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(api.investigations.updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed", error: "boom" }),
		);
		expect(api.timeline.create).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.invocationCallOrder[0]).toBeLessThan(
			(api.investigations.updateStatus as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0],
		);
	});

	it("flush() drains the buffered tail synchronously (the conductor's cancelled path)", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		// No size/timer trigger yet — the tail is still buffered.
		expect(appendEvents).not.toHaveBeenCalled();

		await store.flush();

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(2);
	});

	it("flush() cannot double-send: a pending timer flush and flush() drain the buffer once", async () => {
		vi.useFakeTimers();
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		// flush() takes the whole buffer and cancels the pending timer; the later timer
		// fire finds an empty buffer and is a no-op.
		await store.flush();
		await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(1);
	});

	it("flush() on an empty buffer is a no-op", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await store.flush();

		expect(appendEvents).not.toHaveBeenCalled();
	});

	it("never throws when a flush fails — it logs, drops, and counts the batch", async () => {
		const warnSpy = vi
			.spyOn(Logger.prototype, "warn")
			.mockImplementation(() => {});
		const appendEvents = vi.fn().mockRejectedValue(new Error("network down"));
		const { store, api } = makeStore(appendEvents);

		// A size-triggered flush whose POST rejects must not throw out of append.
		for (let i = 1; i <= 25; i++) {
			await expect(store.append(evt(i))).resolves.toBeUndefined();
		}
		expect(appendEvents).toHaveBeenCalledTimes(1);

		// The run still completes: finish resolves and still writes the result.
		await expect(store.finish(REPORT)).resolves.toBeUndefined();
		expect(api.investigations.writeResult).toHaveBeenCalledTimes(1);

		// The drop was logged with a count (per-flush + the terminal total).
		expect(warnSpy).toHaveBeenCalled();
		const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logged).toMatch(/dropped 25 event\(s\)/);
	});
});
