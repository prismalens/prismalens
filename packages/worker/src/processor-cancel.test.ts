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

vi.mock("./db-investigation-store.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./db-investigation-store.js")>();
	return {
		...actual,
		createDbInvestigationStore: vi.fn(() => ({
			create: vi.fn(async () => {}),
			append: vi.fn(async () => {}),
			finish: vi.fn(async () => {}),
			fail: vi.fn(async () => {}),
			flush: vi.fn(async () => {}),
		})),
	};
});

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
const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
	const urlStr = String(url);
	if (urlStr.includes("/internal/investigations/inv-1/status")) {
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	}
	if (urlStr.includes("/internal/investigations/inv-1")) {
		return new Response(
			JSON.stringify({ id: "inv-1", status: "running" }),
			{ status: 200 },
		);
	}
	if (urlStr.includes("/internal/timeline")) {
		return new Response(JSON.stringify({ ok: true }), { status: 201 });
	}
	// LLM config
	return new Response(
		JSON.stringify({
			provider: "openai",
			model: "gpt-4",
			baseUrl: null,
			credentials: { key: "sk-test" },
		}),
		{ status: 200 },
	);
});
vi.stubGlobal("fetch", fetchMock);

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
		fetchMock.mockClear();
		fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
			const urlStr = String(url);
			if (urlStr.includes("/internal/investigations/inv-1/status")) {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			if (urlStr.includes("/internal/investigations/inv-1")) {
				return new Response(
					JSON.stringify({ id: "inv-1", status: "running" }),
					{ status: 200 },
				);
			}
			if (urlStr.includes("/internal/timeline")) {
				return new Response(JSON.stringify({ ok: true }), { status: 201 });
			}
			return new Response(
				JSON.stringify({
					provider: "openai",
					model: "gpt-4",
					baseUrl: null,
					credentials: { key: "sk-test" },
				}),
				{ status: 200 },
			);
		});
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
		// Terminal "cancelled" status write is owned by the run via internal PATCH
		const statusCall = fetchMock.mock.calls.find((c) =>
			String(c[0]).includes("/internal/investigations/inv-1/status"),
		);
		expect(statusCall).toBeDefined();
		const [, statusInit] = statusCall!;
		expect(statusInit?.method).toBe("PATCH");
		expect(
			(statusInit?.headers as Record<string, string>)["X-Internal-Secret"],
		).toBe("test-secret");
		expect(JSON.parse(statusInit?.body as string)).toMatchObject({
			status: "cancelled",
			error: "Investigation cancelled",
		});

		// Timeline entry is persisted via internal POST with source "ai_worker"
		const timelineCall = fetchMock.mock.calls.find((c) =>
			String(c[0]).includes("/internal/timeline") &&
			(c[1]?.body ? JSON.parse(c[1].body as string).title === "Investigation cancelled" : false),
		);
		expect(timelineCall).toBeDefined();
		const [, timelineInit] = timelineCall!;
		expect(timelineInit?.method).toBe("POST");
		expect(
			(timelineInit?.headers as Record<string, string>)["X-Internal-Secret"],
		).toBe("test-secret");
		expect(JSON.parse(timelineInit?.body as string)).toMatchObject({
			incidentId: "inc-1",
			type: "investigation_completed",
			title: "Investigation cancelled",
			source: "ai_worker",
			metadata: { investigationId: "inv-1" },
		});

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
		// Transient internal API failure on the terminal write: must not escape to the outer
		// catch (which would mark the run "failed" and rethrow into a retry).
		fetchMock.mockImplementation(async (url: string | URL) => {
			const urlStr = String(url);
			if (urlStr.includes("/internal/investigations/inv-1/status")) {
				return new Response("502 upstream", {
					status: 502,
					statusText: "Bad Gateway",
				});
			}
			if (urlStr.includes("/internal/investigations/inv-1")) {
				return new Response(
					JSON.stringify({ id: "inv-1", status: "running" }),
					{ status: 200 },
				);
			}
			if (urlStr.includes("/internal/timeline")) {
				return new Response(JSON.stringify({ ok: true }), { status: 201 });
			}
			return new Response(
				JSON.stringify({
					provider: "openai",
					model: "gpt-4",
					baseUrl: null,
					credentials: { key: "sk-test" },
				}),
				{ status: 200 },
			);
		});

		const result = await processInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
		);

		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});

	it("skips the run entirely when the investigation is already cancelled (sticky cancel)", async () => {
		fetchMock.mockImplementation(async (url: string | URL) => {
			const urlStr = String(url);
			if (urlStr.includes("/internal/investigations/inv-1")) {
				return new Response(
					JSON.stringify({ id: "inv-1", status: "cancelled" }),
					{ status: 200 },
				);
			}
			return new Response(
				JSON.stringify({
					provider: "openai",
					model: "gpt-4",
					baseUrl: null,
					credentials: { key: "sk-test" },
				}),
				{ status: 200 },
			);
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
