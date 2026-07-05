/**
 * Hermetic test for the worker's CANCEL path (CANCEL slice, ADR-0018): a Redis message
 * on `investigation:cancel:<id>` must flip the run's AbortSignal, and the cancelled
 * outcome must persist status "cancelled" + a timeline entry and RETURN a result (never
 * throw — a throw would let BullMQ retry a user-cancelled run). Every seam is mocked
 * (ioredis / engine / orpc api / llm-config fetch), per the processor.test.ts pattern —
 * no network, no LLM, no real queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CANCELLED_MESSAGE = "investigation cancelled by request";

const mocks = vi.hoisted(() => {
	interface MockRedis {
		publish: ReturnType<typeof vi.fn>;
		quit: ReturnType<typeof vi.fn>;
		removeAllListeners: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		subscribe: ReturnType<typeof vi.fn>;
		__channels: Set<string>;
		__emit: (channel: string, message: string) => void;
	}
	const redisInstances: MockRedis[] = [];
	const api = {
		investigations: { updateStatus: vi.fn(async () => ({})) },
		timeline: { create: vi.fn(async () => ({})) },
		incidents: { get: vi.fn(async () => ({ id: "inc-1", title: "Boom" })) },
	};
	const conductRun = vi.fn();
	return { redisInstances, api, conductRun };
});

vi.mock("ioredis", () => ({
	Redis: vi.fn(function MockRedis() {
		const handlers: Array<(ch: string, msg: string) => void> = [];
		const channels = new Set<string>();
		const inst = {
			publish: vi.fn(async () => 0),
			quit: vi.fn(async () => "OK"),
			removeAllListeners: vi.fn(),
			on: vi.fn((event: string, cb: (ch: string, msg: string) => void) => {
				if (event === "message") handlers.push(cb);
				return inst;
			}),
			subscribe: vi.fn(async (ch: string) => {
				channels.add(ch);
			}),
			__channels: channels,
			__emit: (ch: string, msg: string) => {
				if (channels.has(ch)) for (const h of handlers) h(ch, msg);
			},
		};
		mocks.redisInstances.push(inst);
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

function makeJob(investigationId: string, incidentId: string) {
	return {
		id: `investigation-${investigationId}`,
		name: "investigate",
		data: { investigationId, incidentId, alerts: [], priority: "normal" },
		updateProgress: vi.fn(async () => {}),
		// biome-ignore lint/suspicious/noExplicitAny: minimal SandboxedJob stand-in.
	} as any;
}

describe("processor CANCEL path (ADR-0018)", () => {
	beforeEach(() => {
		mocks.api.investigations.updateStatus.mockClear();
		mocks.api.timeline.create.mockClear();
		mocks.redisInstances.length = 0;
		mocks.conductRun.mockReset();
	});

	it("a cancel message flips the signal → persists status 'cancelled' + timeline, returns (no throw)", async () => {
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

		const job = makeJob("inv-1", "inc-1");
		const cancelChannel = "investigation:cancel:inv-1";
		const done = processInvestigationJob(job);

		// Wait until the run is in-flight (conductRun awaiting) and the cancel subscriber
		// is up, then deliver the cancel message on the dedicated channel.
		await vi.waitFor(() => {
			expect(mocks.conductRun).toHaveBeenCalled();
			const sub = mocks.redisInstances.find((i) =>
				i.__channels.has(cancelChannel),
			);
			expect(sub).toBeDefined();
		});
		const sub = mocks.redisInstances.find((i) =>
			i.__channels.has(cancelChannel),
		);
		sub?.__emit(cancelChannel, "cancel");

		const result = await done;

		// The signal the engine received actually aborted.
		expect(sawSignal?.aborted).toBe(true);
		// Terminal "cancelled" status write is owned by the worker (conductRun left the
		// store untouched).
		expect(mocks.api.investigations.updateStatus).toHaveBeenCalledWith(
			expect.objectContaining({ id: "inv-1", status: "cancelled" }),
		);
		expect(mocks.api.timeline.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Investigation cancelled" }),
		);
		// Returned (not thrown), distinguishably cancelled — BullMQ marks it done, no retry.
		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});
});
