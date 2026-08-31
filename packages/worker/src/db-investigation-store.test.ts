// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
import {
	createDbInvestigationStore,
	type DbInvestigationStoreParams,
	fetchInvestigation,
} from "./db-investigation-store.js";

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
	options: Partial<DbInvestigationStoreParams> = {},
) {
	const store = createDbInvestigationStore(api, {
		investigationId: INVESTIGATION_ID,
		incidentId: INCIDENT_ID,
		runId: RUN_ID,
		apiBaseUrl: "http://api.test",
		internalSecret: "test-secret",
		appendEvents,
		...options,
	});
	return { store, api };
}

/**
 * `InvestigationStore.flush` is optional on the interface (some adapters don't
 * buffer), but `createDbInvestigationStore` always provides it. Rather than
 * asserting that away with `!`, verify it as part of the test's arrangement
 * and hand back a narrowed, correctly-typed reference — a `!` here would
 * silence the checker instead of establishing the fact.
 */
function flushOf(store: ReturnType<typeof createDbInvestigationStore>) {
	if (!store.flush) {
		throw new Error(
			"createDbInvestigationStore's store must provide flush() — got none",
		);
	}
	return store.flush;
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
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const createTimeline = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents, makeApi(), {
			updateStatus,
			createTimeline,
		});

		await store.append(evt(1));
		await store.fail("boom");

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed", error: "boom" }),
		);
		expect(createTimeline).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.invocationCallOrder[0]).toBeLessThan(
			updateStatus.mock.invocationCallOrder[0],
		);
	});

	it("flush() drains the buffered tail synchronously (the conductor's cancelled path)", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await store.append(evt(1));
		await store.append(evt(2));
		// No size/timer trigger yet — the tail is still buffered.
		expect(appendEvents).not.toHaveBeenCalled();

		await flushOf(store)();

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
		await flushOf(store)();
		await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

		expect(appendEvents).toHaveBeenCalledTimes(1);
		expect(appendEvents.mock.calls[0][0]).toHaveLength(1);
	});

	it("flush() on an empty buffer is a no-op", async () => {
		const appendEvents = vi.fn().mockResolvedValue(undefined);
		const { store } = makeStore(appendEvents);

		await flushOf(store)();

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

describe("createDbInvestigationStore — internal endpoints write-back (#535)", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("create() writes running status and started timeline via internal endpoints with X-Internal-Secret", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { store } = makeStore(vi.fn());
		await store.create();

		expect(fetchMock).toHaveBeenCalledTimes(2);

		// First call: PATCH /internal/investigations/:id/status
		const [statusUrl, statusInit] = fetchMock.mock.calls[0];
		expect(statusUrl).toBe(
			`http://api.test/internal/investigations/${INVESTIGATION_ID}/status`,
		);
		expect(statusInit.method).toBe("PATCH");
		expect(statusInit.headers).toMatchObject({
			"Content-Type": "application/json",
			"X-Internal-Secret": "test-secret",
		});
		expect(JSON.parse(statusInit.body as string)).toEqual({
			status: "running",
			harnessThreadId: RUN_ID,
		});

		// Second call: POST /internal/timeline
		const [timelineUrl, timelineInit] = fetchMock.mock.calls[1];
		expect(timelineUrl).toBe("http://api.test/internal/timeline");
		expect(timelineInit.method).toBe("POST");
		expect(timelineInit.headers).toMatchObject({
			"Content-Type": "application/json",
			"X-Internal-Secret": "test-secret",
		});
		expect(JSON.parse(timelineInit.body as string)).toEqual({
			incidentId: INCIDENT_ID,
			type: "investigation_started",
			title: "AI Investigation Started",
			description: "Starting the two-tier engine investigation",
			source: "ai_worker",
			metadata: { investigationId: INVESTIGATION_ID },
		});
	});

	it("fail() writes failed status and failure timeline via internal endpoints with X-Internal-Secret", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { store } = makeStore(vi.fn());
		await store.fail("disk full");

		expect(fetchMock).toHaveBeenCalledTimes(2);

		// First call: PATCH /internal/investigations/:id/status
		const [statusUrl, statusInit] = fetchMock.mock.calls[0];
		expect(statusUrl).toBe(
			`http://api.test/internal/investigations/${INVESTIGATION_ID}/status`,
		);
		expect(statusInit.method).toBe("PATCH");
		expect(statusInit.headers).toMatchObject({
			"Content-Type": "application/json",
			"X-Internal-Secret": "test-secret",
		});
		expect(JSON.parse(statusInit.body as string)).toEqual({
			status: "failed",
			error: "disk full",
		});

		// Second call: POST /internal/timeline
		const [timelineUrl, timelineInit] = fetchMock.mock.calls[1];
		expect(timelineUrl).toBe("http://api.test/internal/timeline");
		expect(timelineInit.method).toBe("POST");
		expect(timelineInit.headers).toMatchObject({
			"Content-Type": "application/json",
			"X-Internal-Secret": "test-secret",
		});
		expect(JSON.parse(timelineInit.body as string)).toEqual({
			incidentId: INCIDENT_ID,
			type: "investigation_completed",
			title: "AI Investigation Failed",
			description: "disk full",
			source: "ai_worker",
			metadata: { investigationId: INVESTIGATION_ID, error: "disk full" },
		});
	});

	it("create() throws when PRISMALENS_INTERNAL_SECRET is missing", async () => {
		const store = createDbInvestigationStore(makeApi(), {
			investigationId: INVESTIGATION_ID,
			incidentId: INCIDENT_ID,
			runId: RUN_ID,
			apiBaseUrl: "http://api.test",
			internalSecret: undefined,
			appendEvents: vi.fn(),
		});

		await expect(store.create()).rejects.toThrow(
			/PRISMALENS_INTERNAL_SECRET not set/,
		);
	});

	it("fail() throws when PRISMALENS_INTERNAL_SECRET is missing", async () => {
		const store = createDbInvestigationStore(makeApi(), {
			investigationId: INVESTIGATION_ID,
			incidentId: INCIDENT_ID,
			runId: RUN_ID,
			apiBaseUrl: "http://api.test",
			internalSecret: undefined,
			appendEvents: vi.fn(),
		});

		await expect(store.fail("boom")).rejects.toThrow(
			/PRISMALENS_INTERNAL_SECRET not set/,
		);
	});

	it("throws when internal endpoint returns non-2xx status", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("Unauthorized", {
				status: 401,
				statusText: "Unauthorized",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { store } = makeStore(vi.fn());
		await expect(store.create()).rejects.toThrow(
			/update-status failed: 401 Unauthorized/,
		);
	});
});

describe("fetchInvestigation (#537)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches investigation via internal endpoint with X-Internal-Secret", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ id: INVESTIGATION_ID, status: "cancelled" }),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchInvestigation(
			"http://api.test",
			"test-secret",
			INVESTIGATION_ID,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(
			`http://api.test/internal/investigations/${INVESTIGATION_ID}`,
		);
		expect(init.method).toBe("GET");
		expect(init.headers).toMatchObject({
			"X-Internal-Secret": "test-secret",
		});
		expect(result).toEqual({ id: INVESTIGATION_ID, status: "cancelled" });
	});

	it("throws when PRISMALENS_INTERNAL_SECRET is missing", async () => {
		await expect(
			fetchInvestigation("http://api.test", undefined, INVESTIGATION_ID),
		).rejects.toThrow(/PRISMALENS_INTERNAL_SECRET not set/);
	});

	it("throws when internal endpoint returns non-2xx status", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("Not Found", {
				status: 404,
				statusText: "Not Found",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			fetchInvestigation("http://api.test", "test-secret", INVESTIGATION_ID),
		).rejects.toThrow(/fetch-investigation failed: 404 Not Found/);
	});
});
