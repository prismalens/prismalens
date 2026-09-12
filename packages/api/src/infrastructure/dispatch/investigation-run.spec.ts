// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the one-ACP-run-per-investigation job (0005 §2, ADR 0002/0004):
 * `parseSandboxMode`, `deriveAllowedHosts` (the egress allowlist), `resolveWorkspace`
 * (the per-investigation clone under the app-data dir — ADR 0004 §2, no user checkout
 * as cwd), and `runInvestigationJob`'s schema-validation/failure-persistence paths.
 * No network, no LLM, no real harness — `@prismalens/engine` is mocked wherever a test
 * needs `conductRun` to run at all.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { CanonicalEvent, InvestigationJobData } from "@prismalens/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { RunPorts } from "./run-ports.js";

const mocks = vi.hoisted(() => ({ conductRun: vi.fn() }));

vi.mock("@prismalens/engine", () => ({
	conductRun: mocks.conductRun,
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

const {
	parseSandboxMode,
	deriveAllowedHosts,
	resolveWorkspace,
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
			selection: { runnable: true as const, harness: "opencode" as const, auto: true, verified: true },
		})),
		getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
		incidentRepos: vi.fn(async () => []),
		repoToken: vi.fn(async () => null),
		ensureClone: vi.fn(async () => ({ path: "/app-data/repos/clone", head: "abc123def456", action: "cloned" as const })),
		...overrides,
	};
}

describe("parseSandboxMode (PRISMALENS_SANDBOX knob, ADR-0020 B.1.3)", () => {
	it("defaults to auto when unset (B.1.1 egress-gate flip)", () => {
		expect(parseSandboxMode(undefined)).toBe("auto");
	});

	it("accepts every selectable mode", () => {
		expect(parseSandboxMode("process")).toBe("process");
		expect(parseSandboxMode("auto")).toBe("auto");
		expect(parseSandboxMode("srt")).toBe("srt");
		expect(parseSandboxMode("e2b")).toBe("e2b");
	});

	it("rejects an unknown value loudly (never silently degrades)", () => {
		expect(() => parseSandboxMode("docker")).toThrowError(
			/Invalid PRISMALENS_SANDBOX/,
		);
	});
});

describe("deriveAllowedHosts (egress allowlist, ADR-0020)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("includes hostnames from the context's telemetry and logs URLs", () => {
		const hosts = deriveAllowedHosts({
			alerts: [],
			telemetry: {
				prometheusUrl: "http://prometheus.internal:9090",
				alertmanagerUrl: "http://alertmanager.internal:9093",
			},
			logs: { url: "http://loki.internal:3100" },
		} as never);
		expect(hosts).toContain("prometheus.internal");
		expect(hosts).toContain("alertmanager.internal");
		expect(hosts).toContain("loki.internal");
	});

	it("folds PRISMALENS_SANDBOX_ALLOWED_HOSTS (comma-separated) in too", () => {
		vi.stubEnv("PRISMALENS_SANDBOX_ALLOWED_HOSTS", "api.example.com, other.example.com");
		const hosts = deriveAllowedHosts({ alerts: [] } as never);
		expect(hosts).toContain("api.example.com");
		expect(hosts).toContain("other.example.com");
	});

	it("skips an unparseable telemetry URL rather than opening egress", () => {
		const hosts = deriveAllowedHosts({
			alerts: [],
			telemetry: { prometheusUrl: "not a url" },
		} as never);
		expect(hosts).not.toContain("not a url");
	});

	it("dedupes hosts named more than once", () => {
		const hosts = deriveAllowedHosts({
			alerts: [],
			telemetry: {
				prometheusUrl: "http://shared.internal:9090",
				alertmanagerUrl: "http://shared.internal:9093",
			},
		} as never);
		expect(new Set(hosts).size).toBe(hosts.length);
	});
});

/**
 * ADR 0004 §2: the harness runs in prismalens's own clone, never the user's checkout.
 * No linked repo means an honest UNMAPPED run in an empty scratch dir; a linked repo
 * means `ports.ensureClone` is called with the repo's url/defaultBranch/token and the
 * cwd is the clone path plus the repo's subPath.
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

	it("a linked repo: ensureClone gets url/defaultBranch/token, and cwd is the clone path plus subPath", async () => {
		const ensureClone = vi.fn(async () => ({
			path: "/app-data/repos/github.com/acme/api-gateway",
			head: "abc123def456789",
			action: "cloned" as const,
		}));
		const repoToken = vi.fn(async () => "gh-token-123");
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{
					url: "https://github.com/acme/api-gateway",
					defaultBranch: "main",
					subPath: "services/api",
					connectionId: "conn-1",
				},
			]),
			repoToken,
			ensureClone,
		});

		const ws = await resolveWorkspace(minimalData(), ports);

		expect(repoToken).toHaveBeenCalledWith("conn-1");
		expect(ensureClone).toHaveBeenCalledWith({
			url: "https://github.com/acme/api-gateway",
			defaultBranch: "main",
			token: "gh-token-123",
		});
		expect(ws.mapped).toBe(true);
		expect(ws.cwd).toBe(join("/app-data/repos/github.com/acme/api-gateway", "services/api"));
		expect(ws.note).toContain("https://github.com/acme/api-gateway");
	});

	it("a linked repo with no subPath: cwd is the clone path itself", async () => {
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ url: "https://github.com/acme/api-gateway", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			ensureClone: vi.fn(async () => ({
				path: "/app-data/repos/github.com/acme/api-gateway",
				head: "abc123def456789",
				action: "updated" as const,
			})),
		});

		const ws = await resolveWorkspace(minimalData(), ports);

		expect(ws.cwd).toBe("/app-data/repos/github.com/acme/api-gateway");
	});

	it("a linked repo with no connectionId: repoToken is never called, ensureClone gets a null token", async () => {
		const repoToken = vi.fn(async () => "should-not-be-called");
		const ensureClone = vi.fn(async () => ({
			path: "/app-data/repos/github.com/acme/x",
			head: "abc123def456789",
			action: "cloned" as const,
		}));
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ url: "https://github.com/acme/x", defaultBranch: null, subPath: null, connectionId: null },
			]),
			repoToken,
			ensureClone,
		});

		await resolveWorkspace(minimalData(), ports);

		expect(repoToken).not.toHaveBeenCalled();
		expect(ensureClone).toHaveBeenCalledWith({
			url: "https://github.com/acme/x",
			defaultBranch: null,
			token: null,
		});
	});

	it("only the primary (first) repo is used when a service has more than one", async () => {
		const ensureClone = vi.fn(async () => ({
			path: "/app-data/repos/github.com/acme/primary",
			head: "abc123def456789",
			action: "cloned" as const,
		}));
		const ports = fakePorts({
			incidentRepos: vi.fn(async () => [
				{ url: "https://github.com/acme/primary", defaultBranch: "main", subPath: null, connectionId: null },
				{ url: "https://github.com/acme/secondary", defaultBranch: "main", subPath: null, connectionId: null },
			]),
			ensureClone,
		});

		await resolveWorkspace(minimalData(), ports);

		expect(ensureClone).toHaveBeenCalledTimes(1);
		expect(ensureClone).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://github.com/acme/primary" }),
		);
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
