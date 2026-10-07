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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running", harness: null, model: null, acpSessionId: null, workspace: null })),
		updateStatus: vi.fn(async () => {}),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		followUpStatus: vi.fn(async () => {}),
		lastEventSeq: vi.fn(async () => -1),
		recordSession: vi.fn(async () => {}),
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

			expect(ws.layout).toBe("unmapped");
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
						serviceName: "checkout",
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
			expect(ws.layout).toBe("single");
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
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null, serviceName: "checkout" },
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
				{ sourceKind: "url" as const, url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: "../../outside", connectionId: null, serviceName: "checkout" },
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
					{ sourceKind: "url" as const, url: "https://github.com/acme/x", defaultBranch: null, subPath: null, connectionId: null, serviceName: "checkout" },
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

	describe("every repo the incident touches (#747)", () => {
		afterEach(() => vi.unstubAllEnvs());
		const at = (dest: string) => ({ path: dest, head: `${dest.endsWith("worker") ? "5d6e7f8" : "1a2b3c4"}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, branch: "main" as const });
		const repo = (url: string, serviceName: string, subPath: string | null = null) => ({
			sourceKind: "url" as const,
			url,
			defaultBranch: "main",
			subPath,
			connectionId: null,
			serviceName,
		});

		it("two services with different repos: repos/api and repos/worker, cwd is their parent, the note names both commits", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
			const snapshot = vi.fn(async (_src: unknown, dest: string) => at(dest));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs", "svc/jobs"),
				]),
				snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshot.mock.calls.map((c) => c[1])).toEqual([
				"/ws/runs/inv-1/repos/api",
				"/ws/runs/inv-1/repos/worker",
			]);
			expect(ws.layout).toBe("multi");
			expect(ws.cwd).toBe("/ws/runs/inv-1/repos");
			expect(ws.repos.map((r) => [r.name, r.services, r.subPath])).toEqual([
				["api", ["checkout"], null],
				["worker", ["jobs"], "svc/jobs"],
			]);
			expect(ws.note).toBe(
				"Investigating snapshots of 2 repositories: api (URL git@github.com:o/api.git) at main 1a2b3c4, worker (URL git@github.com:o/worker.git/svc/jobs) at main 5d6e7f8. Uncommitted changes are not included.",
			);
		});

		it("a secondary repo that cannot be copied is skipped and named in the note; the primary's failure still fails", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
			const snapshot = vi.fn(async (_src: unknown, dest: string) => {
				if (dest.endsWith("worker")) throw new Error("repository not found");
				return at(dest);
			});
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs"),
				]),
				snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.layout).toBe("single");
			expect(ws.cwd).toBe("/ws/runs/inv-1/repos/api");
			expect(ws.repos.map((r) => r.name)).toEqual(["api"]);
			expect(ws.note).toContain(
				"Not included, because it could not be copied: URL git@github.com:o/worker.git (repository not found).",
			);

			const primaryDown = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/worker.git", "checkout"),
					repo("git@github.com:o/api.git", "jobs"),
				]),
				snapshot,
			});
			await expect(resolveWorkspace(minimalData(), primaryDown)).rejects.toThrow("repository not found");
		});

		it("one repository linked by two services is cloned once with both service names", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
			const snapshot = vi.fn(async (_src: unknown, dest: string) => at(dest));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("https://github.com/acme/primary", "checkout"),
					repo("https://github.com/acme/primary", "cart", "sub"),
				]),
				snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(snapshot).toHaveBeenCalledTimes(1);
			expect(ws.layout).toBe("single");
			expect(ws.repos[0]).toMatchObject({ name: "repo", services: ["checkout", "cart"], subPath: null });
		});

		it("two repos with the same folder name: the second gets -2", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", "/ws");
			const snapshot = vi.fn(async (_src: unknown, dest: string) => at(dest));
			const ports = fakePorts({
				incidentRepos: vi.fn(async () => [
					repo("https://github.com/acme/api", "checkout"),
					repo("https://github.com/other/api", "billing"),
				]),
				snapshot,
			});

			const ws = await resolveWorkspace(minimalData(), ports);

			expect(ws.repos.map((r) => r.name)).toEqual(["api", "api-2"]);
		});

		it("the run records the workspace on the row and hands the prompt every repo", async () => {
			vi.stubEnv("PRISMALENS_WORKSPACE_DIR", mkdtempSync(join(os.tmpdir(), "pl-appdata-")));
			const updateStatus = vi.fn(async () => {});
			const ports = fakePorts({
				updateStatus,
				incidentRepos: vi.fn(async () => [
					repo("git@github.com:o/api.git", "checkout"),
					repo("git@github.com:o/worker.git", "jobs"),
				]),
				snapshot: vi.fn(async (_src: unknown, dest: string) => at(dest)),
			});
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});

			await runInvestigationJob(
				{ id: "job-1", investigationId: "inv-1", attempts: 1 },
				minimalData(),
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);

			const [, dto] = updateStatus.mock.calls[0] as unknown as [string, { workspace?: string }];
			expect(JSON.parse(dto.workspace ?? "null")).toMatchObject({ layout: "multi", repos: [{ name: "api" }, { name: "worker" }] });
			const [opts] = mocks.conductRun.mock.calls[0] as [{ context: { workspace?: { repos: { path: string }[] } } }];
			expect(opts.context.workspace?.repos.map((r) => r.path)).toEqual(["api/", "worker/"]);
		});
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
					serviceName: "checkout",
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
				title: "Investigation failed",
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

describe("the agent's own mode (#673 w21)", () => {
	it("asks for the job's mode, else Settings', else the row's default, and keeps it on the row", async () => {
		const modeOf = async (job: { agentMode?: string }, settings?: string) => {
			mocks.conductRun.mockReset();
			mocks.conductRun.mockImplementation(async (_o, io: { store: { create(): Promise<void> } }) => {
				await io.store.create();
				return { report: { summary: "done", rootCause: null, nextSteps: [] } };
			});
			const ports = fakePorts();
			const resolve = ports.resolveHarness;
			ports.resolveHarness = vi.fn(async () => ({ ...(await resolve()), ...(settings ? { agentMode: settings } : {}) }));
			await runInvestigationJob(
				{ id: "job-mode", investigationId: "inv-mode", attempts: 1 },
				{ investigationId: "inv-mode", incidentId: "inc-mode", ...job },
				{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
				ports,
			);
			const [opts] = mocks.conductRun.mock.calls[0] as [{ agentMode?: string }];
			expect(ports.updateStatus).toHaveBeenCalledWith("inv-mode", expect.objectContaining({ agentMode: opts.agentMode }));
			return opts.agentMode;
		};
		expect(await modeOf({ agentMode: "build" }, "plan")).toBe("build");
		expect(await modeOf({}, "build")).toBe("build");
		expect(await modeOf({})).toBe("plan");
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


/**
 * A message on a finished run continues the same session in the first run's
 * workspace, rebuilt at the same path and commits; it is chat only (#747).
 */
describe("follow-up on a finished run (#747)", () => {
	const HEAD = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(os.tmpdir(), "pl-followup-"));
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", tmp);
		const bin = join(tmp, "bin");
		mkdirSync(bin);
		writeFileSync(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
		vi.stubEnv("PATH", bin);
		mocks.conductRun.mockReset();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(tmp, { recursive: true, force: true });
	});

	const restore = { status: "completed" as const, completedAt: "2026-09-30T10:00:00.000Z", error: null };
	const data: InvestigationJobData = {
		investigationId: "inv-1",
		incidentId: "inc-1",
		resume: { text: "why the pool?", mode: "queue", restore },
	};
	function recorded(dir: string) {
		return JSON.stringify({
			layout: "single",
			cwd: dir,
			repos: [
				{ name: "repo", dir, sourceKind: "url", url: "https://github.com/acme/api", subPath: null, connectionId: null, head: HEAD, branch: "main", services: ["checkout"] },
			],
		});
	}
	function followUpPorts(overrides: Partial<RunPorts> = {}) {
		const dir = join(tmp, "runs", "inv-1", "repo");
		return fakePorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: "opencode/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(dir),
			})),
			lastEventSeq: vi.fn(async () => 41),
			snapshot: vi.fn(async (_src: unknown, dest: string) => ({ path: dest, head: HEAD, branch: null })),
			...overrides,
		});
	}
	const io = () => ({ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal });

	it("rebuilds at the recorded commit and path, loads the same session after the stored events, and puts the row back untouched", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: null, failureKind: "none" };
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(true);
		expect(ports.snapshot).toHaveBeenCalledWith(
			{ kind: "url", source: "https://github.com/acme/api", token: null },
			join(tmp, "runs", "inv-1", "repo"),
			expect.any(AbortSignal),
			HEAD,
		);
		expect(ports.clearEvents).not.toHaveBeenCalled();
		const [opts] = mocks.conductRun.mock.calls[0] as [
			{ seqStart: number; model: string; resume: { sessionId: string; text: string; heads: unknown } },
		];
		expect(opts.seqStart).toBe(42);
		expect(opts.model).toBe("opencode/some-model");
		expect(opts.resume).toMatchObject({ sessionId: "ses_abc", text: "why the pool?", heads: [{ name: "repo", head: HEAD }] });
		expect(ports.createTimelineEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Investigation resumed",
				description: "Continuing the same OpenCode session in a fresh workspace pinned to 1a2b3c4.",
			}),
		);
		// Chat only: no report write, no status write that delivers, and the row goes back.
		expect(ports.writeResult).not.toHaveBeenCalled();
		expect(ports.updateStatus).not.toHaveBeenCalled();
		expect(vi.mocked(ports.followUpStatus).mock.calls.at(-1)).toEqual([
			"inv-1",
			{ status: "completed", completedAt: new Date(restore.completedAt), error: null },
		]);
		expect(existsSync(join(tmp, "runs", "inv-1", "repo"))).toBe(false);
	});

	it("puts a continued run back when it fails before the row went live (R4.4)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockRejectedValue(new Error("db down"));

		const result = await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, kind: "continue" } },
			io(),
			ports,
		);

		expect(result.success).toBe(false);
		expect(vi.mocked(ports.followUpStatus).mock.calls.at(-1)).toEqual([
			"inv-1",
			{ status: "completed", completedAt: new Date(restore.completedAt), error: null },
		]);
	});

	it("leaves a continued run that went live to own its end state (R4.4)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockImplementation(async (_o, run: { store: { create(): Promise<void> } }) => {
			await run.store.create();
			return { runId: "inv-1", report: null, error: "agent died", failureKind: "error" };
		});

		await runInvestigationJob(
			{ id: "job-2", investigationId: "inv-1", attempts: 1 },
			{ ...data, resume: { ...data.resume!, kind: "continue" } },
			io(),
			ports,
		);

		expect(vi.mocked(ports.followUpStatus).mock.calls.map(([, dto]) => dto.status)).toEqual(["running"]);
	});

	it("tells the engine the reopened run's model was the operator's, so the agent must take it (R4.2)", async () => {
		const ports = followUpPorts();
		mocks.conductRun.mockResolvedValue({ runId: "inv-1", report: null, error: null, failureKind: "none" });

		await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ model: string; modelSource: string }];
		expect(opts).toMatchObject({ model: "opencode/some-model", modelSource: "operator" });
	});

	it("refuses a run whose agent kept no session, says so in the conversation, and puts the row back", async () => {
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "opencode",
				model: null,
				acpSessionId: null,
				workspace: null,
			})),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(false);
		expect(result.error).toBe("This run cannot be continued: its agent kept no session to reopen.");
		expect(mocks.conductRun).not.toHaveBeenCalled();
		const [, events] = vi.mocked(ports.appendEvents).mock.calls[0] as [string, CanonicalEvent[]];
		expect(events.map((e) => [e.kind, e.seq])).toEqual([
			["operator_message", 42],
			["error", 43],
		]);
		expect(ports.updateStatus).not.toHaveBeenCalled();
		expect(vi.mocked(ports.followUpStatus).mock.calls.at(-1)?.[1]).toMatchObject({ status: "completed" });
	});

	it("refuses to continue on a harness that can't reopen a session (deepagents), before any clone or conductRun", async () => {
		const ports = followUpPorts({
			findInvestigation: vi.fn(async () => ({
				id: "inv-1",
				status: "pending",
				harness: "deepagents",
				model: "deepagents/some-model",
				acpSessionId: "ses_abc",
				workspace: recorded(join(tmp, "runs", "inv-1", "repo")),
			})),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.success).toBe(false);
		expect(result.error).toBe("deepagents can't reopen a finished session, so a new run starts from the report.");
		expect(mocks.conductRun).not.toHaveBeenCalled();
		expect(ports.snapshot).not.toHaveBeenCalled();
	});

	it("a commit the source lost fails with git's own text, and no clone is left", async () => {
		const ports = followUpPorts({
			snapshot: vi.fn(async (_src: unknown, dest: string) => {
				mkdirSync(dest, { recursive: true });
				throw new Error(`fatal: reference is not a tree: ${HEAD}`);
			}),
		});

		const result = await runInvestigationJob({ id: "job-2", investigationId: "inv-1", attempts: 1 }, data, io(), ports);

		expect(result.error).toBe(`fatal: reference is not a tree: ${HEAD}`);
		expect(existsSync(join(tmp, "runs", "inv-1", "repo"))).toBe(false);
	});
});

describe("a chat run (#673)", () => {
	it("hands the engine the message as a chat and succeeds with no report, never failing the run", async () => {
		mocks.conductRun.mockReset();
		mocks.conductRun.mockResolvedValue({ runId: "inv-chat", report: null, error: null, failureKind: "none" });
		const ports = fakePorts();

		const result = await runInvestigationJob(
			{ id: "job-chat", investigationId: "inv-chat", attempts: 1 },
			{
				investigationId: "inv-chat",
				incidentId: "inc-chat",
				brief: "never sent",
				kind: "chat",
				chat: { text: "Is the pool still saturated?" },
			},
			{ emit: vi.fn(), streamDone: vi.fn(), signal: new AbortController().signal },
			ports,
		);

		const [opts] = mocks.conductRun.mock.calls[0] as [{ kind?: string; brief?: string }];
		expect(opts).toMatchObject({ kind: "chat", brief: "Is the pool still saturated?" });
		expect(result).toMatchObject({ success: true, investigationId: "inv-chat" });
		expect(result).not.toHaveProperty("error");
		expect(ports.updateStatus).not.toHaveBeenCalledWith("inv-chat", expect.objectContaining({ status: "failed" }));
	});
});
