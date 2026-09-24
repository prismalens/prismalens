// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the one-ACP-run-per-investigation job (0005 §2, ADR 0002/0004):
 * `resolveWorkspace` (the per-investigation clone under the app-data dir — ADR 0004 §2,
 * no user checkout as cwd), and `runInvestigationJob`'s schema-validation/failure-persistence paths.
 * No network, no LLM, no real harness — `@prismalens/engine` is mocked wherever a test
 * needs `conductRun` to run at all.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { CanonicalEvent, InvestigationJobData } from "@prismalens/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { RunPorts } from "./run-ports.js";

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

const {
	resolveWorkspace,
	runDirFor,
	default: runInvestigationJob,
} = await import("./investigation-run.js");

/** A `RunPorts` double covering exactly what the job makes. */
function fakePorts(overrides: Partial<RunPorts> = {}): RunPorts {
	return {
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running" })),
		updateStatus: vi.fn(async () => {}),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		writeResult: vi.fn(async () => {}),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveHarness: vi.fn(async () => ({
			selection: { runnable: true as const, harness: "opencode" as const, auto: true },
		})),
		getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
		incidentRepos: vi.fn(async () => []),
		repoToken: vi.fn(async () => null),
		snapshot: vi.fn(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", branch: "main" as const })),
		resolveConnectors: vi.fn(async () => []),
		contextPack: vi.fn(async () => null),
		...overrides,
	};
}

/**
 * ADR 0004 §2: the harness runs in a fresh snapshot of prismalens's own repo,
 * never the user's checkout. No linked repo means an honest UNMAPPED run in an
 * empty scratch dir; a linked repo means `ports.snapshot` is called with the
 * repo's kind/source/defaultBranch/token and a dest under the run dir, and the
 * cwd is the snapshot path plus the repo's subPath.
 */
describe("resolveWorkspace (per-investigation harness cwd)", () => {
	function minimalData(overrides: Partial<InvestigationJobData> = {}): InvestigationJobData {
		return { investigationId: "inv-1", incidentId: "inc-1", ...overrides };
	}

	it("no linked repo: an UNMAPPED scratch dir under the app-data dir, and it exists on disk", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const ports = fakePorts({ incidentRepos: vi.fn(async () => []) });
			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.mapped).toBe(false);
			expect(ws.cwd).toBe(join(tmp, "runs", "inv-1", "unmapped"));
			expect(existsSync(ws.cwd)).toBe(true);
			expect(ws.note).toContain("no repository linked");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("a linked repo: snapshot gets kind/source/defaultBranch/token and a dest under the run dir, cwd is the snapshot path plus subPath, and the note names the commit", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const snapshot = vi.fn(async () => ({
				path: "/app-data/repos/github.com/acme/api-gateway",
				head: "abc123def456789",
				branch: "main" as const,
			}));
			const repoToken = vi.fn(async () => "gh-token-123");
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{
						sourceKind: "url" as const,
						url: "https://github.com/acme/api-gateway",
						defaultBranch: "main",
						subPath: "services/api",
						connectionId: "conn-1",
					},
				]),
				repoToken,
				snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(repoToken).toHaveBeenCalledWith("conn-1");
			expect(snapshot).toHaveBeenCalledWith(
				{
					kind: "url",
					source: "https://github.com/acme/api-gateway",
					defaultBranch: "main",
					token: "gh-token-123",
				},
				join(tmp, "runs", "inv-1", "repo"),
				undefined,
			);
			expect(ws.mapped).toBe(true);
			expect(ws.cwd).toBe(join("/app-data/repos/github.com/acme/api-gateway", "services/api"));
			expect(ws.note).toContain("https://github.com/acme/api-gateway");
			expect(ws.note).toContain("abc123def456");
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("a linked repo with no subPath: cwd is the snapshot path itself", async () => {
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			snapshot: vi.fn(async () => ({
				path: "/app-data/repos/github.com/acme/api-gateway",
				head: "abc123def456789",
				branch: "main" as const,
			})),
		});

		const ws = await resolveWorkspace(minimalData(), ports);

		expect(ws.cwd).toBe("/app-data/repos/github.com/acme/api-gateway");
	});

	it("a stored subPath that climbs out of the snapshot fails the run instead of widening the cwd", async () => {
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: "../../outside", connectionId: null },
			]),
			snapshot: vi.fn(async () => ({
				path: "/app-data/runs/r1/repo",
				head: "abc123def456789",
				branch: "main" as const,
			})),
		});

		await expect(resolveWorkspace(minimalData(), ports)).rejects.toThrow(
			/escapes the snapshot/,
		);
	});

	it("a linked repo with no connectionId: repoToken is never called, snapshot gets a null token", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-appdata-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const repoToken = vi.fn(async () => "should-not-be-called");
			const snapshot = vi.fn(async () => ({
				path: "/app-data/repos/github.com/acme/x",
				head: "abc123def456789",
				branch: null,
			}));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					{ sourceKind: "url" as const, url: "https://github.com/acme/x", defaultBranch: null, subPath: null, connectionId: null },
				]),
				repoToken,
				snapshot,
			});

			await resolveWorkspace(minimalData(), ports);

			expect(repoToken).not.toHaveBeenCalled();
			expect(snapshot).toHaveBeenCalledWith(
				{ kind: "url", source: "https://github.com/acme/x", defaultBranch: null, token: null },
				join(tmp, "runs", "inv-1", "repo"),
				undefined,
			);
		} finally {
			vi.unstubAllEnvs();
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("only the primary (first) repo is used when a service has more than one", async () => {
		const snapshot = vi.fn(async () => ({
			path: "/app-data/repos/github.com/acme/primary",
			head: "abc123def456789",
			branch: "main" as const,
		}));
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ sourceKind: "url" as const, url: "https://github.com/acme/primary", defaultBranch: "main", subPath: null, connectionId: null },
				{ sourceKind: "url" as const, url: "https://github.com/acme/secondary", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			snapshot,
		});

		await resolveWorkspace(minimalData(), ports);

		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(snapshot).toHaveBeenCalledWith(
			expect.objectContaining({ source: "https://github.com/acme/primary" }),
			expect.any(String),
			undefined,
		);
	});

	it("a folder-source repo: snapshot gets kind 'folder' with the folder path as source, and the note says so", async () => {
		const snapshot = vi.fn(async () => ({
			path: "/app-data/runs/inv-1/repo",
			head: "abc123def456789",
			branch: null,
		}));
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{
					sourceKind: "folder" as const,
					url: "/home/dev/checkouts/api-gateway",
					defaultBranch: null,
					subPath: null,
					connectionId: null,
				},
			]),
			snapshot,
		});

		const ws = await resolveWorkspace(minimalData(), ports);

		expect(snapshot).toHaveBeenCalledWith(
			{
				kind: "folder",
				source: "/home/dev/checkouts/api-gateway",
				defaultBranch: null,
				token: null,
			},
			expect.any(String),
			undefined,
		);
		expect(ws.note).toContain("folder");
	});
});

describe("runInvestigationJob schema validation", () => {
	it("malformed job payload -> throws, not silent degradation", async () => {
		const job = { id: "job-malformed", investigationId: "inv-malformed", attempts: 1 };
		const malformedData = {
			// Missing required incidentId and investigationId
			priority: "invalid-priority",
		};

		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: the point is an invalid payload.
			runInvestigationJob(job, malformedData as any, {
				emit: vi.fn(),
				streamDone: vi.fn(),
				signal: new AbortController().signal,
			}, fakePorts()),
		).rejects.toThrow();
	});

	it("missing or absent alerts remains valid per schema", async () => {
		const validJobWithoutAlerts = {
			incidentId: "inc-123",
			investigationId: "inv-123",
		};
		const { InvestigationJobDataSchema } = await import("@prismalens/contracts");
		expect(() =>
			InvestigationJobDataSchema.parse(validJobWithoutAlerts),
		).not.toThrow();
	});

	// Follow-up 4, issue #302 / #537: the schema parse lives INSIDE the
	// failure-persisting try/catch. A payload that carries usable identifiers but fails
	// validation must still leave a terminal "failed" investigation row and a timeline
	// entry — never a row dangling at "pending" because the parse threw past the handler.
	it("parse failure still persists a failed status and timeline entry from the raw identifiers", async () => {
		const updateStatus = vi.fn(
			async (
				_id: string,
				_dto: {
					status: "running" | "failed" | "completed" | "cancelled";
					error?: string;
					harnessThreadId?: string;
					startedAt?: Date;
				},
			) => {},
		);
		const createTimelineEntry = vi.fn(async (_dto: CreateTimelineEntryDto) => {});
		const ports = fakePorts({ updateStatus, createTimelineEntry });

		const job = { id: "job-parse-fail", investigationId: "inv-parse-fail", attempts: 1 };
		const malformedDataWithIds = {
			investigationId: "inv-parse-fail",
			incidentId: "inc-parse-fail",
			priority: "invalid-priority",
		};

		await expect(
			runInvestigationJob(job, malformedDataWithIds as never, {
				emit: vi.fn(),
				streamDone: vi.fn(),
				signal: new AbortController().signal,
			}, ports),
		).rejects.toThrow();

		expect(updateStatus).toHaveBeenCalledWith(
			"inv-parse-fail",
			expect.objectContaining({ status: "failed" }),
		);
		const [, statusDto] = updateStatus.mock.calls[0];
		expect((statusDto as { error?: string }).error).toContain("priority");

		expect(createTimelineEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "inc-parse-fail",
				type: "investigation_completed",
				title: "AI Investigation Failed",
				source: "ai_worker",
				metadata: expect.objectContaining({ investigationId: "inv-parse-fail" }),
			}),
		);
	});

	// Refusal path (#520, ADR-0031): an unrunnable harness selection must fail the run
	// with the selection's own reason, not a generic error.
	it("an unrunnable harness selection fails the job with the selection's reason", async () => {
		const updateStatus = vi.fn(async () => {});
		const ports = fakePorts({
			updateStatus,
			resolveHarness: vi.fn(async () => ({
				selection: {
					runnable: false as const,
					failure: "no-harness" as const,
					reason: "No coding agent found on PATH.",
				},
			})),
		});

		await expect(
			runInvestigationJob(
				{ id: "job-1", investigationId: "inv-1", attempts: 1 },
				{ investigationId: "inv-1", incidentId: "inc-1" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			),
		).rejects.toThrow(/No coding agent found on PATH/);

		expect(updateStatus).toHaveBeenCalledWith(
			"inv-1",
			expect.objectContaining({ status: "failed", error: "No coding agent found on PATH." }),
		);
	});
});

/**
 * 0005 §2 regression: `getIncident` hands back the raw Prisma row now, not a
 * JSON-round-tripped one — `triggeredAt` is a real `Date`, not a string. The
 * degenerate no-alerts path used to cast it straight to `string`, which built
 * a `FiringAlert` the contract schema then rejected downstream. Verified here
 * through the context `conductRun` actually receives.
 */
describe("assembled investigation context (Date-typed incident fields)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not throw when the incident's date fields are real Date instances", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				title: "No alerts here",
				triggeredAt: new Date("2026-07-31T10:00:00.000Z"),
			})),
		});

		await runInvestigationJob(
			{ id: "job-no-alerts", investigationId: "inv-no-alerts", attempts: 1 },
			{ investigationId: "inv-no-alerts", incidentId: "inc-no-alerts" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { alerts: Array<{ startsAt: string | null }> } }];
		expect(opts.context.alerts).toHaveLength(1);
		expect(opts.context.alerts[0].startsAt).toBe("2026-07-31T10:00:00.000Z");
	});
});

/**
 * ADR 0004 §5 / #628: the harness child never gets `process.env` verbatim. The
 * only env `conductRun` receives is the resolved harness's own provider keys,
 * never a `PRISMALENS_*` name — even one sitting right next to a real
 * provider key in the parent process.
 */
describe("harness child env (trust floor, #628)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("passes the resolved harness's provider keys, never PRISMALENS_* or the rest of process.env", async () => {
		vi.stubEnv("PRISMALENS_AUTH_SECRET", "leak-me");
		vi.stubEnv("PRISMALENS_WEBHOOK_SECRET", "leak-me-too");
		vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
		vi.stubEnv("SOME_UNRELATED_HOST_VAR", "noise");
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts();

		await runInvestigationJob(
			{ id: "job-env", investigationId: "inv-env", attempts: 1 },
			{ investigationId: "inv-env", incidentId: "inc-env" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ env: Record<string, string> }];
		// `resolveHarness` in `fakePorts` defaults to opencode, which lists
		// ANTHROPIC_API_KEY among its provider keys (registry row).
		expect(opts.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
		expect(opts.env.PRISMALENS_AUTH_SECRET).toBeUndefined();
		expect(opts.env.PRISMALENS_WEBHOOK_SECRET).toBeUndefined();
		expect(opts.env.SOME_UNRELATED_HOST_VAR).toBeUndefined();
	});
});

describe("run snapshot reaping (#637 N3)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("deletes runs/<id>/repo when the job ends and keeps the transcript", async () => {
		const tmp = mkdtempSync(join(os.tmpdir(), "pl-reap-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		try {
			const runDir = join(tmp, "runs", "inv-reap");
			mkdirSync(join(runDir, "repo"), { recursive: true });
			writeFileSync(join(runDir, "repo", "file.txt"), "x");
			writeFileSync(join(runDir, "transcript.jsonl"), "{}\n");
			mocks.conductRun.mockReset();
			mocks.conductRun.mockResolvedValue({
				report: { summary: "done", rootCause: null, nextSteps: [] },
			});

			await runInvestigationJob(
				{ id: "job-reap", investigationId: "inv-reap", attempts: 1 },
				{ investigationId: "inv-reap", incidentId: "inc-reap" },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				fakePorts(),
			);

			expect(existsSync(join(runDir, "repo"))).toBe(false);
			expect(existsSync(join(runDir, "transcript.jsonl"))).toBe(true);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("runDirFor (#643 review)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("keeps a run directory directly under runs/ and refuses an id that escapes it", () => {
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
		expect(runDirFor("0b3c2f1e-1111-4222-8333-444455556666")).toBe(
			"/ws/runs/0b3c2f1e-1111-4222-8333-444455556666",
		);
		for (const bad of ["../../etc", "a/b", "..", "", "staging/../other-id"]) {
			expect(() => runDirFor(bad), bad).toThrow(/Invalid investigation id/);
		}
	});
});

describe("connector resolution into investigation telemetry (#633)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("records telemetry.prometheus hostname in investigation_started metadata when resolver returns prometheus", async () => {
		const timelineMock = vi.fn(async () => {});
		const ports = fakePorts({
			createTimelineEntry: timelineMock,
			getIncident: vi.fn(async () => ({
				id: "inc-telemetry",
				title: "Prometheus alert",
				serviceId: "svc-1",
			})),
			resolveConnectors: vi.fn(async () => [
				{
					templateId: "prometheus",
					connectionId: "conn-1",
					label: "Prometheus",
					baseUrl: "http://prom.internal:9090",
					segments: ["metrics"],
				},
			]),
		});
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});

		await runInvestigationJob(
			{ id: "job-telemetry", investigationId: "inv-telemetry", attempts: 1 },
			{ investigationId: "inv-telemetry", incidentId: "inc-telemetry" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(timelineMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "investigation_started",
				metadata: expect.objectContaining({
					telemetry: { prometheus: "prom.internal" },
				}),
			}),
		);
	});

	it("proceeds with no telemetry when resolveConnectors throws", async () => {
		const timelineMock = vi.fn(async () => {});
		const ports = fakePorts({
			createTimelineEntry: timelineMock,
			getIncident: vi.fn(async () => ({
				id: "inc-err",
				title: "Prometheus alert",
				serviceId: "svc-1",
			})),
			resolveConnectors: vi.fn(async () => {
				throw new Error("DB error resolving connectors");
			}),
		});
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});

		const result = await runInvestigationJob(
			{ id: "job-err", investigationId: "inv-err", attempts: 1 },
			{ investigationId: "inv-err", incidentId: "inc-err" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(result.success).toBe(true);
		expect(timelineMock).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "investigation_started",
				metadata: expect.not.objectContaining({
					telemetry: expect.anything(),
				}),
			}),
		);
	});
});

describe("context pack reaches the run (#633)", () => {
	const PACK = {
		window: { start: "2026-09-19T00:00:00Z", end: "2026-09-20T00:00:00Z" },
		changes: [],
		neighbors: [],
		priorIncidents: [],
		unavailable: [],
		assembledAt: "2026-09-20T00:00:00Z",
	};

	it("passes the assembled context pack into conductRun's context", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({ contextPack: vi.fn(async () => PACK) });

		await runInvestigationJob(
			{ id: "job-pack", investigationId: "inv-pack", attempts: 1 },
			{ investigationId: "inv-pack", incidentId: "inc-pack" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(ports.contextPack).toHaveBeenCalledWith("inc-pack");
		const [runArgs] = mocks.conductRun.mock.calls[0] as unknown as [
			{ context: { contextPack?: unknown } },
		];
		expect(runArgs.context.contextPack).toEqual(PACK);
	});

	it("proceeds with no context pack when the port throws", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValueOnce({
			failureKind: null,
			report: { summary: "done", rootCause: null, nextSteps: [] },
		});
		const ports = fakePorts({
			contextPack: vi.fn(async () => {
				throw new Error("DB error assembling context pack");
			}),
		});

		const result = await runInvestigationJob(
			{ id: "job-pack-err", investigationId: "inv-pack-err", attempts: 1 },
			{ investigationId: "inv-pack-err", incidentId: "inc-pack-err" },
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		expect(result.success).toBe(true);
		const [runArgs] = mocks.conductRun.mock.calls[0] as unknown as [
			{ context: { contextPack?: unknown } },
		];
		expect(runArgs.context.contextPack).toBeUndefined();
	});
});

