// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic test for the run's CANCEL path (CANCEL slice, ADR-0018): the host's cancel
 * arrives as an abort on the injected signal, and the cancelled outcome must persist
 * status "cancelled" + a timeline entry and RETURN a result (never throw — a throw would
 * let the host rerun a user-cancelled investigation). Every seam is mocked (engine /
 * orpc api / llm-config fetch), per the processor.test.ts pattern — no network, no LLM,
 * no dispatch loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CANCELLED_MESSAGE = "investigation cancelled by request";

const mocks = vi.hoisted(() => {
	const api = {
		investigations: {
			updateStatus: vi.fn(async () => ({})),
			get: vi.fn(async () => ({ id: "inv-1", status: "running" })),
		},
		timeline: { create: vi.fn(async () => ({})) },
		incidents: { get: vi.fn(async () => ({ id: "inc-1", title: "Boom" })) },
	};
	const conductRun = vi.fn();
	return { api, conductRun };
});

vi.mock("./orpc-client.js", () => ({ api: mocks.api }));

vi.mock("./db-investigation-store.js", () => ({
	createDbInvestigationStore: vi.fn(() => ({
		create: vi.fn(async () => {}),
		append: vi.fn(async () => {}),
		finish: vi.fn(async () => {}),
		fail: vi.fn(async () => {}),
	})),
}));

vi.mock("@prismalens/engine", () => ({
	conductRun: mocks.conductRun,
	resolveInvestigation: vi.fn(() => ({
		context: { alerts: [], telemetry: {} },
		harness: () => (async function* () {})(),
		synth: { providerId: "openai", model: "gpt-4", apiKey: "k" },
		fidelity: undefined,
	})),
	resolveSandbox: vi.fn(() => ({
		sandbox: { destroy: vi.fn(async () => {}) },
	})),
	SANDBOX_MODES: ["process", "auto", "srt", "e2b"],
}));

vi.mock("@prismalens/logger", () => ({
	Logger: vi.fn(function MockLogger() {
		return {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};
	}),
	enrichContext: vi.fn(),
}));

vi.mock("@prismalens/logger/standalone", () => ({
	runWithWideEvent: (_name: string, fn: () => unknown) => fn(),
}));

process.env.PRISMALENS_INTERNAL_SECRET = "test-secret";
vi.stubGlobal(
	"fetch",
	vi.fn(async () => ({
		ok: true,
		json: async () => ({
			provider: "openai",
			model: "gpt-4",
			baseUrl: null,
			credentials: { key: "sk-test" },
		}),
	})),
);

const { default: processInvestigationJob } = await import("./processor.js");

function makeJob(investigationId: string) {
	return {
		id: `job-${investigationId}`,
		name: "investigate",
		attemptsMade: 0,
		updateProgress: vi.fn(async () => {}),
	};
}

function makeData(investigationId: string, incidentId: string) {
	return {
		investigationId,
		incidentId,
		alerts: [],
		priority: "normal" as const,
	};
}

/** The host side of the run's IPC channel, reduced to what the processor consumes. */
function makeIo(signal: AbortSignal) {
	return {
		emit: vi.fn(),
		streamDone: vi.fn(),
		signal,
	};
}

describe("processor CANCEL path (ADR-0018)", () => {
	beforeEach(() => {
		mocks.api.investigations.updateStatus.mockClear();
		mocks.api.investigations.updateStatus.mockResolvedValue({});
		mocks.api.investigations.get.mockClear();
		mocks.api.investigations.get.mockResolvedValue({
			id: "inv-1",
			status: "running",
		});
		mocks.api.timeline.create.mockClear();
		mocks.conductRun.mockReset();
	});

	it("the host's cancel flips the signal → persists status 'cancelled' + timeline, returns (no throw)", async () => {
		// conductRun blocks until the run's signal aborts, then resolves the cancelled
		// outcome — exactly the engine contract the worker relies on.
		let sawSignal: AbortSignal | undefined;
		mocks.conductRun.mockImplementation(
			async (opts: { runId: string; signal?: AbortSignal }) => {
				sawSignal = opts.signal;
				await new Promise<void>((resolve) => {
					if (opts.signal?.aborted) return resolve();
					opts.signal?.addEventListener("abort", () => resolve(), {
						once: true,
					});
				});
				return {
					runId: opts.runId,
					report: null,
					error: CANCELLED_MESSAGE,
					failureKind: "cancelled",
				};
			},
		);

		const controller = new AbortController();
		const io = makeIo(controller.signal);
		const done = processInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			io,
		);

		// Wait until the run is in-flight (conductRun awaiting), then deliver the cancel
		// exactly as the host's IPC handler would.
		await vi.waitFor(() => {
			expect(mocks.conductRun).toHaveBeenCalled();
		});
		controller.abort();

		const result = await done;

		// The signal the engine received actually aborted.
		expect(sawSignal?.aborted).toBe(true);
		// Terminal "cancelled" status write is owned by the run (conductRun left the
		// store untouched).
		expect(mocks.api.investigations.updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ id: "inv-1", status: "cancelled" }),
		);
		expect(mocks.api.timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Investigation cancelled" }),
		);
		// Returned (not thrown), distinguishably cancelled — the host settles it, no rerun.
		expect(io.streamDone).toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});

	it("a persistCancelled failure is swallowed — the job still returns cancelled (no rerun)", async () => {
		mocks.conductRun.mockResolvedValue({
			runId: "inv-1",
			report: null,
			error: CANCELLED_MESSAGE,
			failureKind: "cancelled",
		});
		// Transient API failure on the terminal write: must not escape to the outer
		// catch (which would mark the run "failed" and rethrow into a retry).
		mocks.api.investigations.updateStatus.mockRejectedValue(
			new Error("502 upstream"),
		);

		const result = await processInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
		);

		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});

	it("skips the run entirely when the investigation is already cancelled (sticky cancel)", async () => {
		mocks.api.investigations.get.mockResolvedValue({
			id: "inv-1",
			status: "cancelled",
		});

		const result = await processInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
		);

		expect(mocks.conductRun).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});
});
