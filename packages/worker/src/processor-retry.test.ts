/**
 * Hermetic test for the worker's RETRY fresh-record path (ADR-0018 B.4): on a BullMQ
 * retry (attemptsMade > 0) the processor must clear the prior attempt's durable event
 * record via the internal clear-events endpoint BEFORE conducting the run, so attempt 2's
 * events don't collide with attempt 1's (P2002-swallowed duplicates). On the first
 * attempt (attemptsMade === 0) it must NOT clear. Every seam is mocked (ioredis / engine /
 * orpc api / fetch), per the processor-cancel.test.ts pattern — no network, no LLM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const api = {
		investigations: { updateStatus: vi.fn(async () => ({})) },
		timeline: { create: vi.fn(async () => ({})) },
		incidents: { get: vi.fn(async () => ({ id: "inc-1", title: "Boom" })) },
	};
	const conductRun = vi.fn();
	return { api, conductRun };
});

vi.mock("ioredis", () => ({
	Redis: vi.fn(function MockRedis() {
		const inst = {
			publish: vi.fn(async () => 0),
			quit: vi.fn(async () => "OK"),
			removeAllListeners: vi.fn(),
			on: vi.fn(() => inst),
			subscribe: vi.fn(async () => {}),
		};
		return inst;
	}),
}));

vi.mock("./orpc-client.js", () => ({ api: mocks.api }));

vi.mock("./db-investigation-store.js", () => ({
	createDbInvestigationStore: vi.fn(() => ({
		create: vi.fn(async () => {}),
		append: vi.fn(async () => {}),
		finish: vi.fn(async () => {}),
		fail: vi.fn(async () => {}),
		flush: vi.fn(async () => {}),
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
		return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
	}),
	enrichContext: vi.fn(),
}));

vi.mock("@prismalens/logger/standalone", () => ({
	runWithWideEvent: (_name: string, fn: () => unknown) => fn(),
}));

process.env.PRISMALENS_INTERNAL_SECRET = "test-secret";

const fetchMock = vi.fn(async (url: string | URL) => {
	if (String(url).includes("/events/clear")) {
		return { ok: true, json: async () => ({ deleted: 3 }) } as Response;
	}
	// LLM-credentials fetch.
	return {
		ok: true,
		json: async () => ({
			provider: "openai",
			model: "gpt-4",
			baseUrl: null,
			credentials: { key: "sk-test" },
		}),
	} as unknown as Response;
});
vi.stubGlobal("fetch", fetchMock);

const { default: processInvestigationJob } = await import("./processor.js");

function makeJob(attemptsMade: number) {
	return {
		id: "investigation-inv-1",
		name: "investigate",
		attemptsMade,
		data: {
			investigationId: "inv-1",
			incidentId: "inc-1",
			alerts: [],
			priority: "normal",
		},
		updateProgress: vi.fn(async () => {}),
		// biome-ignore lint/suspicious/noExplicitAny: minimal SandboxedJob stand-in.
	} as any;
}

function clearCalls() {
	return fetchMock.mock.calls.filter((c) =>
		String(c[0]).includes("/internal/investigations/inv-1/events/clear"),
	);
}

describe("processor RETRY fresh-record path (ADR-0018 B.4)", () => {
	beforeEach(() => {
		fetchMock.mockClear();
		mocks.conductRun.mockReset();
		// A clean, report-producing run so the processor completes normally.
		mocks.conductRun.mockResolvedValue({
			runId: "inv-1",
			report: { summary: "ok", rootCause: null, nextSteps: [] },
			error: null,
			failureKind: "none",
		});
	});

	it("attemptsMade > 0: clears the durable record before conducting the run", async () => {
		await processInvestigationJob(makeJob(1));

		expect(clearCalls()).toHaveLength(1);
		const [, init] = clearCalls()[0];
		expect(init?.method).toBe("POST");
		expect((init?.headers as Record<string, string>)["X-Internal-Secret"]).toBe(
			"test-secret",
		);
		expect(mocks.conductRun).toHaveBeenCalledTimes(1);
	});

	it("attemptsMade === 0 (first attempt): does NOT clear", async () => {
		await processInvestigationJob(makeJob(0));

		expect(clearCalls()).toHaveLength(0);
		expect(mocks.conductRun).toHaveBeenCalledTimes(1);
	});
});
