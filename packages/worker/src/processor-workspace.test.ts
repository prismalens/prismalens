// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic test for the #331 workspace RECORD, driven through the whole run.
 *
 * `processor.test.ts` pins the resolution (what `buildRequest` puts in
 * `request.cwd`). This pins the other half, which lives inside
 * `processJobInternal` — the function #350 rewrote to run inside the forked
 * child with an injected `JobContext`/`JobIo` instead of a BullMQ
 * `SandboxedJob`. The record has to survive that rewrite: an investigation that
 * ran in the wrong tree produces confident garbage, so the incident timeline
 * must name the directory, say whether it was mapped, and do it BEFORE the
 * harness starts.
 *
 * Every seam is mocked (engine / orpc api / llm-config fetch) per the
 * processor-cancel.test.ts pattern — no network, no LLM, no dispatch loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MAPPED = "/home/dev/checkouts/api-gateway";

const mocks = vi.hoisted(() => {
	const api = {
		investigations: {
			updateStatus: vi.fn(async () => ({})),
			get: vi.fn(async () => ({ id: "inv-1", status: "running" })),
		},
		// The parameter is declared (rather than left inferred as zero-arity) so
		// `create.mock.calls` carries the recorded argument. Without it the calls
		// tuple is empty and `workspaceEntry()` below can only get at the entry by
		// asserting `undefined` into a shape — which would silence the checker
		// instead of establishing the fact. (#302 follow-up 3 removes this
		// package's test exclusion, so these files are type-checked now.)
		timeline: {
			create: vi.fn(async (_entry: Record<string, unknown>) => ({})),
		},
		incidents: { get: vi.fn(async () => ({}) as Record<string, unknown>) },
		services: {
			list: vi.fn(async () => ({ data: [], total: 0 })),
		},
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

function makeJob() {
	return {
		id: "job-inv-1",
		name: "investigate",
		attemptsMade: 0,
		updateProgress: vi.fn(async () => {}),
	};
}

const data = {
	investigationId: "inv-1",
	incidentId: "inc-1",
	alerts: [],
	priority: "normal" as const,
};

/** The host side of the run's IPC channel, reduced to what the processor consumes. */
function makeIo() {
	return {
		emit: vi.fn(),
		streamDone: vi.fn(),
		signal: new AbortController().signal,
	};
}

/** The timeline call this feature owns, isolated from the run's other writes. */
function workspaceEntry() {
	return mocks.api.timeline.create.mock.calls
		.map(([entry]) => entry)
		.find((entry) => entry?.type === "investigation_started");
}

describe("#331 workspace record (post-#350 forked-child run)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.PRISMALENS_INVESTIGATION_CWD;
		mocks.api.investigations.get.mockResolvedValue({
			id: "inv-1",
			status: "running",
		});
		mocks.api.services.list.mockResolvedValue({ data: [], total: 0 });
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", findings: [] },
		});
	});

	it("a mapped service: the timeline names the directory, and says it was mapped", async () => {
		mocks.api.incidents.get.mockResolvedValue({
			id: "inc-1",
			title: "Checkout 5xx",
			service: { name: "api-gateway", localCheckoutPath: MAPPED },
		});

		await processInvestigationJob(makeJob(), data, makeIo());

		const entry = workspaceEntry();
		expect(entry).toBeDefined();
		expect(entry?.incidentId).toBe("inc-1");
		expect(entry?.metadata).toMatchObject({
			investigationId: "inv-1",
			cwd: MAPPED,
			mapped: true,
		});
	});

	it("an UNMAPPED service is allowed but never silent — the timeline admits it", async () => {
		mocks.api.incidents.get.mockResolvedValue({
			id: "inc-1",
			title: "Checkout 5xx",
			service: { name: "api-gateway", localCheckoutPath: null },
		});

		await processInvestigationJob(makeJob(), data, makeIo());

		const entry = workspaceEntry();
		expect(entry).toBeDefined();
		expect(entry?.metadata).toMatchObject({ mapped: false });
		expect(String(entry?.title)).toContain("WITHOUT");
	});

	it("the record lands BEFORE the harness runs, not after", async () => {
		mocks.api.incidents.get.mockResolvedValue({
			id: "inc-1",
			title: "Checkout 5xx",
			service: { name: "api-gateway", localCheckoutPath: MAPPED },
		});

		await processInvestigationJob(makeJob(), data, makeIo());

		// A record written after the fact cannot warn anyone reading a run in
		// flight, which is the whole point — assert the ordering, not just presence.
		const recordedAt = mocks.api.timeline.create.mock.invocationCallOrder[0];
		const conductedAt = mocks.conductRun.mock.invocationCallOrder[0];
		expect(recordedAt).toBeLessThan(conductedAt);
	});

	it("a timeline failure does not fail an otherwise-good investigation", async () => {
		mocks.api.incidents.get.mockResolvedValue({
			id: "inc-1",
			title: "Checkout 5xx",
			service: { name: "api-gateway", localCheckoutPath: MAPPED },
		});
		mocks.api.timeline.create.mockRejectedValue(new Error("timeline down"));

		const result = await processInvestigationJob(makeJob(), data, makeIo());

		expect(result.success).toBe(true);
		expect(mocks.conductRun).toHaveBeenCalled();
	});
});
