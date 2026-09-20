// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the run's CANCEL path (CANCEL slice, ADR-0018), the #331
 * workspace record, and the rerun fresh-record guard — ported from
 * `packages/worker/src/processor-cancel.test.ts`, `processor-workspace.test.ts`
 * and `processor-retry.test.ts` (0005 §2: in-process, through a fake
 * {@link RunPorts} instead of fetch/oRPC mocks). Every other seam (engine /
 * logger) stays mocked — no network, no LLM, no dispatch loop.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@prismalens/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { RunPorts } from "./run-ports.js";

const CANCELLED_MESSAGE = "investigation cancelled by request";

const mocks = vi.hoisted(() => ({ conductRun: vi.fn() }));

vi.mock("@prismalens/engine", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@prismalens/engine")>();
	return {
		...actual,
		conductRun: mocks.conductRun,
		resolveSandbox: vi.fn(() => ({
			sandbox: { destroy: vi.fn(async () => {}) },
		})),
		SANDBOX_MODES: ["process", "auto", "srt", "e2b"],
	};
});

vi.mock("@prismalens/logger", () => ({
	Logger: vi.fn(function MockLogger() {
		return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
	}),
	enrichContext: vi.fn(),
}));

vi.mock("@prismalens/logger/standalone", () => ({
	runWithWideEvent: (_name: string, fn: () => unknown) => fn(),
}));

// `createPrismaInvestigationStore` is exercised for real: it is a thin fold over
// `ports.*`, and the fake ports below are what makes it hermetic — no separate
// mock needed for it.
const { default: runInvestigationJob } = await import("./investigation-run.js");

function makeJob(investigationId: string, attempts = 1) {
	return { id: `job-${investigationId}`, investigationId, attempts };
}

function makeData(investigationId: string, incidentId: string) {
	return {
		investigationId,
		incidentId,
		alerts: [],
		priority: "normal" as const,
	};
}

/** The dispatch-loop side of the run's channel, reduced to what the run consumes. */
function makeIo(signal: AbortSignal) {
	return { emit: vi.fn(), streamDone: vi.fn(), signal };
}

function makePorts(overrides: Partial<RunPorts> = {}): RunPorts {
	return {
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running" })),
		updateStatus: vi.fn(async () => {}),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		writeResult: vi.fn(async () => {}),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveHarness: vi.fn(async () => ({
			selection: { runnable: true as const, harness: "opencode" as const, auto: true, verified: true },
		})),
		getIncident: vi.fn(async () => ({ id: "inc-1", title: "Boom" })),
		incidentRepos: vi.fn(async () => []),
		repoToken: vi.fn(async () => null),
		snapshot: vi.fn(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", branch: "main" as const })),
		resolveConnectors: vi.fn(async () => []),
		...overrides,
	};
}

describe("run CANCEL path (ADR-0018)", () => {
	beforeEach(() => {
		mocks.conductRun.mockReset();
	});

	it("the dispatch loop's cancel flips the signal → persists status 'cancelled' + timeline, returns (no throw)", async () => {
		let sawSignal: AbortSignal | undefined;
		mocks.conductRun.mockImplementation(
			async (opts: { runId: string; signal?: AbortSignal }) => {
				sawSignal = opts.signal;
				await new Promise<void>((resolve) => {
					if (opts.signal?.aborted) return resolve();
					opts.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return {
					runId: opts.runId,
					report: null,
					error: CANCELLED_MESSAGE,
					failureKind: "cancelled",
				};
			},
		);

		const updateStatus = vi.fn(async () => {});
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = makePorts({ updateStatus, createTimelineEntry });

		const controller = new AbortController();
		const io = makeIo(controller.signal);
		const done = runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			io,
			ports,
		);

		await vi.waitFor(() => {
			expect(mocks.conductRun).toHaveBeenCalled();
		});
		controller.abort();

		const result = await done;

		expect(sawSignal?.aborted).toBe(true);
		expect(updateStatus).toHaveBeenCalledWith("inv-1", {
			status: "cancelled",
			error: "Investigation cancelled",
		});
		expect(createTimelineEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-1",
				type: "investigation_completed",
				title: "Investigation cancelled",
				source: "ai_worker",
				metadata: { investigationId: "inv-1" },
			}),
		);

		// Returned (not thrown), distinguishably cancelled — the caller settles it, no rerun.
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
		// Transient failure on the terminal write: must not escape to the outer catch
		// (which would mark the run "failed" and rethrow into a retry).
		const ports = makePorts({
			updateStatus: vi.fn(async () => {
				throw new Error("502 upstream");
			}),
		});

		const result = await runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});

	it("skips the run entirely when the investigation is already cancelled (sticky cancel)", async () => {
		const ports = makePorts({
			findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "cancelled" })),
		});

		const result = await runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		expect(mocks.conductRun).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.errorType).toBe("cancelled");
	});
});

const MAPPED = "/home/dev/checkouts/api-gateway";

describe("cancel during the snapshot (#605 edge 23)", () => {
	it("an abort while cloning persists 'cancelled', never 'failed', and the harness never starts", async () => {
		mocks.conductRun.mockReset();
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const controller = new AbortController();
			const updateStatus = vi.fn(async () => {});
			const ports = makePorts({
				updateStatus,
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
				]),
				snapshot: vi.fn(async (_src, _dest, signal?: AbortSignal) => {
					controller.abort(new Error("aborted"));
					throw signal?.reason;
				}),
			});

			const result = await runInvestigationJob(
				makeJob("inv-1"),
				makeData("inv-1", "inc-1"),
				makeIo(controller.signal),
				ports,
			);

			expect(result.success).toBe(false);
			expect(mocks.conductRun).not.toHaveBeenCalled();
			expect(updateStatus).toHaveBeenCalledWith("inv-1", expect.objectContaining({ status: "cancelled" }));
			expect(updateStatus).not.toHaveBeenCalledWith("inv-1", expect.objectContaining({ status: "failed" }));
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("#331 workspace record (in-process run)", () => {
	beforeEach(() => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
	});

	it("a mapped service: the timeline names the directory, and says it was mapped", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
			const snapshot = vi.fn(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const }));
			const ports = makePorts({
				createTimelineEntry,
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
				]),
				snapshot,
			});

			await runInvestigationJob(
				makeJob("inv-1"),
				makeData("inv-1", "inc-1"),
				makeIo(new AbortController().signal),
				ports,
			);

			expect(snapshot).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "url", source: "https://github.com/acme/api-gateway" }),
				join(tmp, "runs", "inv-1", "repo"),
				expect.any(AbortSignal),
			);

			const entry = createTimelineEntry.mock.calls
				.map(([dto]) => dto)
				.find((dto) => dto.type === "investigation_started");
			if (!entry) throw new Error("no investigation_started timeline entry was recorded");
			expect(entry.incidentId).toBe("inc-1");
			expect(entry.metadata).toMatchObject({
				investigationId: "inv-1",
				cwd: MAPPED,
				mapped: true,
			});
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("an UNMAPPED service is allowed but never silent — the timeline admits it", async () => {
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = makePorts({
			createTimelineEntry,
			incidentRepos: vi.fn(async () => []),
		});

		await runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		const entry = createTimelineEntry.mock.calls
			.map(([dto]) => dto)
			.find((dto) => dto.type === "investigation_started");
		if (!entry) throw new Error("no investigation_started timeline entry was recorded");
		expect(entry.metadata).toMatchObject({ mapped: false });
		expect(String(entry.title)).toContain("WITHOUT");
	});

	it("the record lands BEFORE the harness runs, not after", async () => {
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = makePorts({
			createTimelineEntry,
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			snapshot: vi.fn(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const })),
		});

		await runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		const workspaceCallOrder = createTimelineEntry.mock.invocationCallOrder[
			createTimelineEntry.mock.calls.findIndex(
				([dto]) => dto.type === "investigation_started",
			)
		];
		const conductedAt = mocks.conductRun.mock.invocationCallOrder[0];
		expect(workspaceCallOrder).toBeDefined();
		expect(workspaceCallOrder).toBeLessThan(conductedAt);
	});

	it("a timeline failure does not fail an otherwise-good investigation", async () => {
		const ports = makePorts({
			createTimelineEntry: vi.fn(async () => {
				throw new Error("timeline down");
			}),
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			snapshot: vi.fn(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const })),
		});

		const result = await runInvestigationJob(
			makeJob("inv-1"),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		expect(result.success).toBe(true);
		expect(mocks.conductRun).toHaveBeenCalled();
	});
});

describe("rerun fresh-record path (ADR-0018 B.4) — defensive today, no live path (0005 §2: no reclaim)", () => {
	beforeEach(() => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			runId: "inv-1",
			report: { summary: "ok", rootCause: null, nextSteps: [] },
			error: null,
			failureKind: "none",
		});
	});

	it("attempts > 1 (a rerun): clears the durable record before conducting the run", async () => {
		const clearEvents = vi.fn(async () => {});
		const ports = makePorts({ clearEvents });

		await runInvestigationJob(
			makeJob("inv-1", 2),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		expect(clearEvents).toHaveBeenCalledWith("inv-1");
		expect(mocks.conductRun).toHaveBeenCalledTimes(1);
	});

	it("attempts === 1 (first attempt): does NOT clear", async () => {
		const clearEvents = vi.fn(async () => {});
		const ports = makePorts({ clearEvents });

		await runInvestigationJob(
			makeJob("inv-1", 1),
			makeData("inv-1", "inc-1"),
			makeIo(new AbortController().signal),
			ports,
		);

		expect(clearEvents).not.toHaveBeenCalled();
		expect(mocks.conductRun).toHaveBeenCalledTimes(1);
	});
});
