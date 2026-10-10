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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { CanonicalEvent } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { Snapshot } from "../../core/harness/repo-source.service.js";
import type { RepoRef, RunPorts } from "./run-ports.js";

const CANCELLED_MESSAGE = "investigation cancelled by request";

const mocks = vi.hoisted(() => ({ conductRun: vi.fn() }));

vi.mock("@prismalens/engine", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@prismalens/engine")>();
	return {
		...actual,
		conductRun: mocks.conductRun,
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

const PUBLIC_CREDENTIAL = { source: "none" as const, label: "public", via: "none" };

/** A `snapshotWith` double from what the clone returns; the credential is always public. */
function cloneAs(
	fn: (ref: RepoRef, dest: string, signal?: AbortSignal, at?: string) => Promise<Snapshot>,
) {
	return vi.fn(async (ref: RepoRef, dest: string, signal?: AbortSignal, at?: string) => ({
		snap: await fn(ref, dest, signal, at),
		credential: PUBLIC_CREDENTIAL,
	}));
}

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
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running", harness: null, model: null, acpSessionId: null, workspace: null })),
		updateStatus: vi.fn(async () => true),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		followUpStatus: vi.fn(async () => {}),
		initLiveTurn: vi.fn(async () => {}),
		settleFollowUp: vi.fn(async () => true),
		lastEventSeq: vi.fn(async () => -1),
		recordSession: vi.fn(async () => {}),
		markAwaitingApproval: vi.fn(async () => {}),
		newerRun: vi.fn(async () => null),
		writeResult: vi.fn(async () => true),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveHarness: vi.fn(async () => ({
			selection: { runnable: true as const, harness: "opencode" as const, auto: true },
		})),
		getIncident: vi.fn(async () => ({ id: "inc-1", title: "Boom" })),
		incidentRepos: vi.fn(async () => []),
		snapshotWith: cloneAs(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", branch: "main" as const })),
		resolveConnectors: vi.fn(async () => []),
		contextPack: vi.fn(async () => null),
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

		const updateStatus = vi.fn(async () => true);
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
				title: "Investigation stopped",
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
			findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "cancelled", harness: null, model: null, acpSessionId: null, workspace: null })),
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
			const updateStatus = vi.fn(async () => true);
			const ports = makePorts({
				updateStatus,
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
				]),
				snapshotWith: cloneAs(async (_src, _dest, signal?: AbortSignal) => {
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
			const snapshot = cloneAs(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const }));
			const ports = makePorts({
				createTimelineEntry,
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
				]),
				snapshotWith: snapshot,
			});

			await runInvestigationJob(
				makeJob("inv-1"),
				makeData("inv-1", "inc-1"),
				makeIo(new AbortController().signal),
				ports,
			);

			expect(snapshot).toHaveBeenCalledWith(
				expect.objectContaining({ sourceKind: "url", url: "https://github.com/acme/api-gateway" }),
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
		expect(String(entry.title)).toContain("No repository linked");
	});

	it("the record lands BEFORE the harness runs, not after", async () => {
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = makePorts({
			createTimelineEntry,
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
			]),
			snapshotWith: cloneAs(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const })),
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
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
			]),
			snapshotWith: cloneAs(async () => ({ path: MAPPED, head: "abc123def456", branch: "main" as const })),
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

describe("the run owns its row's end (#673 w59, OBJ-010 b)", () => {
	const report = {
		summary: "pool exhausted",
		rootCause: "pool too small",
		rootCauseCategory: "config",
		hypotheses: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
	};

	beforeEach(() => {
		mocks.conductRun.mockReset();
	});

	it("Stop between parse and persist: the run re-reads the row, ends it cancelled, the job ends cancelled, no result or failure side effect (T6)", async () => {
		// The report parsed; Stop landed before the result write, so the row refuses it.
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void>; finish(r: unknown): Promise<void> } }) => {
			await run.store.create();
			await run.store.finish(report);
			return { runId: "inv-1", report, error: null, failureKind: "none" };
		});
		const updateStatus = vi.fn(async (_id: string, dto: { status: string }) => dto.status !== "failed");
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = makePorts({
			writeResult: vi.fn(async () => false),
			updateStatus,
			createTimelineEntry,
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "running",
				harness: null,
				model: null,
				acpSessionId: null,
				workspace: null,
				stopRequestedAt: new Date(),
			})),
		});

		const result = await runInvestigationJob(makeJob("inv-1"), makeData("inv-1", "inc-1"), makeIo(new AbortController().signal), ports);

		expect(result).toMatchObject({ success: false, errorType: "cancelled" });
		expect(updateStatus).toHaveBeenCalledWith("inv-1", { status: "cancelled", error: "Investigation cancelled" });
		expect(updateStatus).not.toHaveBeenCalledWith("inv-1", expect.objectContaining({ status: "failed" }));
		const titles = createTimelineEntry.mock.calls.map(([dto]) => dto.title);
		expect(titles).toContain("Investigation stopped");
		expect(titles).not.toContain("Investigation failed");
		expect(titles).not.toContain("Investigation completed");
		// After a restart the same row ends cancelled too: dispatch.service.spec.ts, T12 "a running job whose row recorded a Stop".
	});

	it("a result write refused with no Stop asked for ends the row failed with the reason, never succeeded", async () => {
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void>; finish(r: unknown): Promise<void> } }) => {
			await run.store.create();
			await run.store.finish(report);
			return { runId: "inv-1", report, error: null, failureKind: "none" };
		});
		const updateStatus = vi.fn(async () => true);
		const ports = makePorts({ writeResult: vi.fn(async () => false), updateStatus });

		const result = await runInvestigationJob(makeJob("inv-1"), makeData("inv-1", "inc-1"), makeIo(new AbortController().signal), ports);

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/^terminal write rejected/);
		expect(updateStatus).toHaveBeenCalledWith("inv-1", expect.objectContaining({ status: "failed", error: result.error }));
	});

	it("an applied end is never read back: a follow-up admitted after it is left alone", async () => {
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void>; finish(r: unknown): Promise<void> } }) => {
			await run.store.create();
			await run.store.finish(report);
			return { runId: "inv-1", report, error: null, failureKind: "none" };
		});
		const findInvestigation = vi.fn(async () => ({ id: "inv-1", status: "running", harness: null, model: null, acpSessionId: null, workspace: null }));
		const ports = makePorts({ findInvestigation });

		const result = await runInvestigationJob(makeJob("inv-1"), makeData("inv-1", "inc-1"), makeIo(new AbortController().signal), ports);

		expect(result.success).toBe(true);
		// Once before the run (sticky cancel), never after its applied end.
		expect(findInvestigation).toHaveBeenCalledTimes(1);
	});
});

describe("the settlement table, DESIGN §3.3 (#673 w59, T8, T9)", () => {
	const HEAD = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
	const NOW = new Date("2026-10-08T17:40:00.000Z");
	const R = {
		completed: { status: "completed" as const, completedAt: "2026-10-08T17:02:00.000Z", error: null },
		cancelled: { status: "cancelled" as const, completedAt: "2026-10-08T17:04:00.000Z", error: "Investigation cancelled" },
		failed: { status: "failed" as const, completedAt: "2026-10-08T17:04:00.000Z", error: "report did not validate" },
	};
	const report = {
		summary: "pool exhausted",
		rootCause: null,
		rootCauseCategory: null,
		hypotheses: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [{ title: "raise the pool", detail: "config.yml", priority: "high" }],
	};
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(os.tmpdir(), "pl-settle-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		const bin = join(tmp, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
		vi.stubEnv("PATH", bin);
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		mocks.conductRun.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		rmSync(tmp, { recursive: true, force: true });
	});

	type Outcome = "answered" | "stopped" | "error";
	/** One follow-up through the real run, its agent ending as `outcome`. */
	async function followUp(
		kind: "investigation" | "chat",
		restore: (typeof R)[keyof typeof R],
		outcome: Outcome,
		opts: {
			continuing?: boolean;
			neverRan?: boolean;
			/** The real X1 boundary: the row went live, then session/load failed before any prompt. */
			loadFails?: boolean;
			/** The agent heard the message, then the run threw before any terminal write. */
			throwsAfterDelivery?: boolean;
			ports?: Partial<RunPorts>;
		} = {},
	) {
		const ports = makePorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "running",
				kind,
				harness: "opencode",
				model: null,
				acpSessionId: "ses_abc",
				workspace: JSON.stringify({ layout: "unmapped", cwd: join(tmp, "runs", "inv-1", "unmapped"), repos: [] }),
			})),
			...opts.ports,
		});
		mocks.conductRun.mockImplementation(
			async (_o, run: { store: { create(): Promise<void>; append(e: unknown): Promise<void>; finish(r: unknown): Promise<void>; fail(e: string): Promise<void> } }) => {
				if (opts.neverRan) throw new Error("the agent would not start");
				// conductRun's order: create() before the session opens (conductor.ts).
				await run.store.create();
				if (opts.loadFails) {
					await run.store.append({ kind: "error", seq: 42, message: "session/load failed: no such session" });
					await run.store.fail("session/load failed: no such session");
					return { runId: "inv-1", report: null, error: "session/load failed: no such session", failureKind: "error" };
				}
				// The engine marks the message delivered just before it prompts.
				await run.store.append({ kind: "operator_message", seq: 42, text: "why?", mode: "queue", delivered: true });
				await run.store.append({ kind: "agent_step", seq: 50, text: "…" });
				if (opts.throwsAfterDelivery) throw new Error("the stream broke");
				if (outcome === "stopped") return { runId: "inv-1", report: null, error: "investigation cancelled", failureKind: "cancelled" };
				if (outcome === "error") {
					await run.store.fail("the agent crashed");
					return { runId: "inv-1", report: null, error: "the agent crashed", failureKind: "error" };
				}
				if (opts.continuing) {
					await run.store.finish(report);
					return { runId: "inv-1", report, error: null, failureKind: "none" };
				}
				return { runId: "inv-1", report: null, error: null, failureKind: "none" };
			},
		);
		const data = {
			investigationId: "inv-1",
			incidentId: "inc-1",
			resume: { text: "why?", mode: "queue" as const, restore, ...(opts.continuing ? { kind: "continue" as const } : {}) },
		};
		const result = await runInvestigationJob(makeJob("inv-1"), data, makeIo(new AbortController().signal), ports);
		return { ports, result };
	}
	const kept = (r: (typeof R)[keyof typeof R]) => ({
		status: r.status,
		completedAt: r.completedAt ? new Date(r.completedAt) : null,
		error: r.error,
	});
	const titles = (ports: RunPorts) =>
		vi.mocked(ports.createTimelineEntry).mock.calls.map(([d]) => d.title).filter((t) => !/resumed/.test(t));

	// Follow-ups that are not a `continue`: one settleFollowUp write each, exactly these columns.
	it.each([
		["I1", "investigation", R.completed, "answered", { ...kept(R.completed), lastTurnOutcome: "answered" }, []],
		["I2", "investigation", R.completed, "stopped", { ...kept(R.completed), lastTurnOutcome: "stopped" }, ["Investigation stopped"]],
		["I3", "investigation", R.completed, "error", { ...kept(R.completed), lastTurnOutcome: "error" }, ["Investigation error"]],
		["I4", "investigation", R.cancelled, "answered", { ...kept(R.cancelled), lastTurnOutcome: "answered" }, []],
		["I5 stopped", "investigation", R.failed, "stopped", { ...kept(R.failed), lastTurnOutcome: "stopped" }, ["Investigation stopped"]],
		["I5 error", "investigation", R.cancelled, "error", { ...kept(R.cancelled), lastTurnOutcome: "error" }, ["Investigation error"]],
		["C1", "chat", R.failed, "answered", { status: "completed", completedAt: NOW, error: null, lastTurnOutcome: "answered" }, ["Chat ended"]],
		["C2", "chat", R.completed, "stopped", { status: "cancelled", completedAt: NOW, error: "Chat stopped", lastTurnOutcome: "stopped" }, ["Chat stopped"]],
		["C3", "chat", R.completed, "error", { status: "failed", completedAt: NOW, error: "the agent crashed", lastTurnOutcome: "error" }, ["Chat error"]],
	] as const)("%s: a %s follow-up ending %s writes exactly its row", async (_row, kind, restore, outcome, columns, entries) => {
		const { ports } = await followUp(kind, restore, outcome);

		expect(vi.mocked(ports.settleFollowUp).mock.calls).toEqual([["inv-1", columns, { stopped: outcome === "stopped" }]]);
		expect(ports.updateStatus).not.toHaveBeenCalled();
		expect(ports.writeResult).not.toHaveBeenCalled();
		expect(titles(ports)).toEqual(entries);
	});

	it("I6: a continue that reports writes the report once, completed now, answered", async () => {
		const { ports, result } = await followUp("investigation", R.cancelled, "answered", { continuing: true });

		expect(result.success).toBe(true);
		expect(vi.mocked(ports.writeResult).mock.calls).toEqual([
			[
				"inv-1",
				expect.objectContaining({
					status: "completed",
					lastTurnOutcome: "answered",
					// Each option carries the id the host stamps on it (#811).
					report: {
						...report,
						nextSteps: report.nextSteps.map((s) => ({ ...s, id: expect.any(String) })),
					},
				}),
			],
		]);
		expect(ports.settleFollowUp).not.toHaveBeenCalled();
	});

	it("I7: a continue that is stopped ends cancelled, stopped", async () => {
		const { ports, result } = await followUp("investigation", R.failed, "stopped", { continuing: true });

		expect(result.errorType).toBe("cancelled");
		expect(vi.mocked(ports.updateStatus).mock.calls.at(-1)).toEqual([
			"inv-1",
			{ status: "cancelled", error: "Investigation cancelled", lastTurnOutcome: "stopped" },
		]);
		expect(titles(ports)).toEqual(["Investigation stopped"]);
		expect(ports.settleFollowUp).not.toHaveBeenCalled();
	});

	it("I8: a continue that errors ends failed with the sentence, error", async () => {
		const { ports } = await followUp("investigation", R.cancelled, "error", { continuing: true });

		expect(vi.mocked(ports.updateStatus).mock.calls.at(-1)).toEqual([
			"inv-1",
			{ status: "failed", error: "the agent crashed", lastTurnOutcome: "error" },
		]);
		expect(titles(ports)).toEqual(["Investigation failed"]);
		expect(ports.settleFollowUp).not.toHaveBeenCalled();
	});

	it("a continue that throws after its agent heard it never leaves the row live: the run ends it failed", async () => {
		const { ports, result } = await followUp("investigation", R.cancelled, "error", {
			continuing: true,
			throwsAfterDelivery: true,
		});

		expect(result.success).toBe(false);
		expect(vi.mocked(ports.findInvestigation)).toHaveBeenCalledTimes(2);
		expect(vi.mocked(ports.updateStatus).mock.calls.at(-1)?.[1]).toMatchObject({ status: "failed" });
		expect(ports.settleFollowUp).not.toHaveBeenCalled();
	});

	it.each([
		["an investigation Ask", "investigation", false],
		["a continue", "investigation", true],
		["a chat's Ask", "chat", false],
	] as const)(
		"X1 at the real boundary: %s whose session/load fails after the row went live puts the standing back (#804 OBJ-026)",
		async (_name, kind, continuing) => {
			const { ports, result } = await followUp(kind, R.cancelled, "error", { continuing, loadFails: true });

			expect(vi.mocked(ports.settleFollowUp).mock.calls).toEqual([
				["inv-1", { ...kept(R.cancelled), lastTurnOutcome: "error" }, { stopped: false }],
			]);
			expect(ports.updateStatus).not.toHaveBeenCalled();
			expect(ports.writeResult).not.toHaveBeenCalled();
			expect(result).toMatchObject({ success: false, error: "session/load failed: no such session" });
		},
	);

	it.each([
		["an Ask", false],
		["a continue", true],
	])("X1: %s whose agent never ran puts the standing back, error, and says so in the conversation", async (_name, continuing) => {
		const { ports } = await followUp("investigation", R.cancelled, "error", { continuing, neverRan: true });

		expect(vi.mocked(ports.settleFollowUp).mock.calls).toEqual([
			["inv-1", { ...kept(R.cancelled), lastTurnOutcome: "error" }, { stopped: false }],
		]);
		const [, said] = vi.mocked(ports.appendEvents).mock.calls.at(-1) as [string, CanonicalEvent[]];
		expect(said.map((e) => e.kind)).toEqual(["operator_message", "error"]);
		expect(ports.updateStatus).not.toHaveBeenCalled();
	});

	it("a settlement that throws once is retried, and the job outcome is the answer's (#804 OBJ-024)", async () => {
		let calls = 0;
		const settleFollowUp = vi.fn(async () => {
			if (calls++ === 0) throw new Error("SQLITE_BUSY");
			return true;
		});
		const { ports, result } = await followUp("investigation", R.completed, "answered", { ports: { settleFollowUp } });

		expect(settleFollowUp).toHaveBeenCalledTimes(2);
		expect(result.success).toBe(true);
		// Applied on the retry: never read back, never re-ended.
		expect(vi.mocked(ports.findInvestigation)).toHaveBeenCalledTimes(1);
	});

	it("a settlement that keeps throwing is never success: the run owns the end and the job fails (#804 OBJ-024)", async () => {
		const settleFollowUp = vi.fn(async (_id: string, _end: { lastTurnOutcome: string }, _o: { stopped: boolean }): Promise<boolean> => {
			throw new Error("SQLITE_BUSY");
		});
		const { ports, result } = await followUp("investigation", R.completed, "answered", { ports: { settleFollowUp } });

		expect(result.success).toBe(false);
		expect(result.error).toMatch(/^terminal write rejected/);
		// The answer's settlement twice, then the run's own end (error) twice.
		expect(settleFollowUp.mock.calls.map(([, end]) => end.lastTurnOutcome)).toEqual([
			"answered",
			"answered",
			"error",
			"error",
		]);
		expect(vi.mocked(ports.findInvestigation)).toHaveBeenCalledTimes(2);
	});

	it("a row that cannot be read back after a refused end is not success (#804 OBJ-024)", async () => {
		let reads = 0;
		const { result } = await followUp("investigation", R.completed, "answered", {
			ports: {
				settleFollowUp: vi.fn(async () => false),
				findInvestigation: vi.fn(async () => {
					if (reads++ > 0) throw new Error("database is locked");
					return {
						id: "inv-1",
						status: "running",
						kind: "investigation",
						harness: "opencode",
						model: null,
						acpSessionId: "ses_abc",
						workspace: JSON.stringify({ layout: "unmapped", cwd: join(tmp, "runs", "inv-1", "unmapped"), repos: [] }),
					};
				}),
			},
		});

		expect(result.success).toBe(false);
	});

	it("a follow-up end refused because Stop was asked for is settled as stopped instead", async () => {
		const settleFollowUp = vi.fn(async (_id: string, _end: unknown, o: { stopped: boolean }) => o.stopped);
		const { ports, result } = await followUp("investigation", R.completed, "answered", {
			ports: {
				settleFollowUp,
				findInvestigation: vi.fn(async () => ({
					id: "inv-1",
					status: "running",
					kind: "investigation",
					harness: "opencode",
					model: null,
					acpSessionId: "ses_abc",
					workspace: JSON.stringify({ layout: "unmapped", cwd: join(tmp, "runs", "inv-1", "unmapped"), repos: [] }),
					stopRequestedAt: new Date(),
				})),
			},
		});

		expect(result.errorType).toBe("cancelled");
		expect(settleFollowUp.mock.calls.map(([, end]) => (end as { lastTurnOutcome: string }).lastTurnOutcome)).toEqual([
			"answered",
			"stopped",
		]);
	});

	// T9: an Ask never changes an investigation's standing, even with the terminal event batch dropped.
	it.each(["answered", "stopped", "error"] as const)(
		"Ask on a stopped reportless investigation ending %s: standing stays cancelled, lastTurnOutcome truthful, events dropped (T9)",
		async (outcome) => {
			const { ports } = await followUp("investigation", R.cancelled, outcome, {
				ports: { appendEvents: vi.fn(async () => { throw new Error("database is locked"); }) },
			});

			expect(vi.mocked(ports.settleFollowUp).mock.calls).toEqual([
				["inv-1", { ...kept(R.cancelled), lastTurnOutcome: outcome }, { stopped: outcome === "stopped" }],
			]);
		},
	);
	// T9 restart: dispatch.service.spec.ts, T12 "an Ask on a stopped reportless run cut off by a restart keeps it cancelled".
});
