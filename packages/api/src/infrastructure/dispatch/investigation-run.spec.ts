// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for `buildHarnessEnv` (ADR-0013 scope boundary), the sandbox/
 * harness guards, and `buildRequest` — ported from `packages/worker/src/processor.test.ts`
 * (0005 §2: the run is in-process, driven through {@link RunPorts} instead of
 * fetch + oRPC mocks). No network / no LLM.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalEvent } from "@prismalens/contracts";
import { Logger } from "@prismalens/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTimelineEntryDto } from "../../modules/timeline/dto/index.js";
import type { RunPorts } from "./run-ports.js";

const {
	buildHarnessEnv,
	speaksOpenAiProtocol,
	parseSandboxMode,
	harnessTakesSandbox,
	deriveWorkerAllowedHosts,
	buildRequest,
	default: runInvestigationJob,
} = await import("./investigation-run.js");

const API_KEY = "secret-key";
const BASE_URL = "http://localhost:11434/v1";

/** A `RunPorts` double covering exactly what `buildRequest`/the run makes. */
function fakePorts(overrides: Partial<RunPorts> = {}): RunPorts {
	return {
		findInvestigation: vi.fn(async () => ({ id: "inv-1", status: "running" })),
		updateStatus: vi.fn(async () => {}),
		appendEvents: vi.fn(async (_id: string, _events: CanonicalEvent[]) => {}),
		clearEvents: vi.fn(async () => {}),
		writeResult: vi.fn(async () => {}),
		createTimelineEntry: vi.fn(async (_dto: CreateTimelineEntryDto) => {}),
		resolveLlm: vi.fn(async () => ({
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			baseUrl: null,
			credentials: { anthropic: API_KEY },
			harness: "auto",
		})),
		integrationCredentials: vi.fn(async () => []),
		getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
		listServices: vi.fn(async () => []),
		...overrides,
	};
}

describe("buildHarnessEnv (ADR-0031 R7 harness-scoped injection)", () => {
	it("deepagents + openai: sends OPENAI_API_KEY, no OPENAI_BASE_URL override", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "openai", API_KEY, BASE_URL),
		).toEqual({
			OPENAI_API_KEY: API_KEY,
		});
	});

	it("deepagents + ollama: sends both OPENAI_API_KEY and OPENAI_BASE_URL", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "ollama", API_KEY, BASE_URL),
		).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("deepagents + keyless ollama: sends OPENAI_BASE_URL without OPENAI_API_KEY (#519)", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "ollama", "", BASE_URL),
		).toEqual({
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("deepagents + custom: sends both OPENAI_API_KEY and OPENAI_BASE_URL", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "custom", API_KEY, BASE_URL),
		).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("claude-code + anthropic (api-key): sends ANTHROPIC_API_KEY only", () => {
		expect(
			buildHarnessEnv("claude-code", "api-key", "anthropic", API_KEY, BASE_URL),
		).toEqual({
			ANTHROPIC_API_KEY: API_KEY,
		});
	});

	it("claude-code + cli-session: injects NO credential env (#525)", () => {
		expect(
			buildHarnessEnv(
				"claude-code",
				"cli-session",
				"openai",
				API_KEY,
				BASE_URL,
			),
		).toEqual({});
	});

	it("deepagents + google: does NOT leak google key", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "google", API_KEY, BASE_URL),
		).toEqual({});
	});

	it("deepagents + groq: does NOT leak groq key", () => {
		expect(
			buildHarnessEnv("deepagents", "api-key", "groq", API_KEY, BASE_URL),
		).toEqual({});
	});
});

describe("speaksOpenAiProtocol (deepagents pre-dispatch guard)", () => {
	it("accepts the OpenAI-protocol providers", () => {
		expect(speaksOpenAiProtocol("openai")).toBe(true);
		expect(speaksOpenAiProtocol("ollama")).toBe(true);
		expect(speaksOpenAiProtocol("custom")).toBe(true);
	});

	it("rejects providers deepagents cannot use", () => {
		expect(speaksOpenAiProtocol("anthropic")).toBe(false);
		expect(speaksOpenAiProtocol("google")).toBe(false);
		expect(speaksOpenAiProtocol("groq")).toBe(false);
	});
});

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

describe("harnessTakesSandbox (CLI-mirrored guard, ADR-0020/0017)", () => {
	it("ACP harness (deepagents) takes a sandbox in any mode", () => {
		expect(harnessTakesSandbox("deepagents", "process")).toBe(true);
		expect(harnessTakesSandbox("deepagents", "auto")).toBe(true);
		expect(harnessTakesSandbox("deepagents", "srt")).toBe(true);
		expect(harnessTakesSandbox("deepagents", "e2b")).toBe(true);
	});

	// FIX 2: plain claude-code under the default `auto` (and `process`) runs WITHOUT a
	// sandbox — no throw. `auto` is best-effort; the best for an in-process harness is none.
	it("non-ACP harness in auto or process mode is allowed but takes no sandbox", () => {
		expect(harnessTakesSandbox("claude-code", "auto")).toBe(false);
		expect(harnessTakesSandbox("claude-code", "process")).toBe(false);
		expect(harnessTakesSandbox("codex", "auto")).toBe(false);
		expect(harnessTakesSandbox("codex", "process")).toBe(false);
	});

	it("non-ACP harness fails the job fast ONLY on a mode that demands enforcement (srt/e2b)", () => {
		expect(() => harnessTakesSandbox("claude-code", "srt")).toThrowError(
			/cannot run inside an enforced sandbox/,
		);
		expect(() => harnessTakesSandbox("claude-code", "e2b")).toThrowError(
			/PRISMALENS_SANDBOX=auto or process|ACP harness/,
		);
	});
});

describe("deriveWorkerAllowedHosts (egress allowlist, ADR-0020)", () => {
	const TELEMETRY_HOSTS = ["localhost"]; // prometheus/alertmanager/api all local by default

	it("includes the active provider's allowedHosts plus telemetry surfaces", () => {
		const hosts = deriveWorkerAllowedHosts("openai");
		expect(hosts).toContain("api.openai.com");
		for (const host of TELEMETRY_HOSTS) expect(hosts).toContain(host);
	});

	it("folds an extra endpoint (the resolved synth base URL) in by hostname", () => {
		const hosts = deriveWorkerAllowedHosts("ollama", ["https://ollama.com/v1"]);
		expect(hosts).toContain("ollama.com");
	});

	it("a null provider allowlist (custom) contributes no provider host, no hole", () => {
		const hosts = deriveWorkerAllowedHosts("custom");
		expect(hosts).toContain("localhost");
		expect(new Set(hosts).size).toBe(hosts.length);
	});

	it("skips an unparseable extra URL rather than opening egress", () => {
		const hosts = deriveWorkerAllowedHosts("openai", ["not a url"]);
		expect(hosts).not.toContain("not a url");
	});
});

describe("buildRequest settings isolation (ADR-0020 server placement)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function armEnv(): void {
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
	}

	// The regression this guards: an unattended server run that inherits the host
	// account's `~/.claude` executes its hooks and plugins ON THE HOST, outside the
	// boundary the run resolved — and behaves unlike the CLI and unlike every eval.
	it("isolates host settings/hooks/plugins/MCP on the unattended server path", async () => {
		armEnv();
		const { request } = await buildRequest(
			{ incidentId: "inc-1", investigationId: "inv-1" },
			fakePorts(),
		);
		expect(request.isolateSettings).toBe(true);
	});

	// Isolation is a placement property, not a per-job one: no job payload may opt out.
	it("isolates regardless of the job payload", async () => {
		armEnv();
		const { request } = await buildRequest(
			{
				incidentId: "inc-2",
				investigationId: "inv-2",
				alerts: [{ alertname: "HighLatency", severity: "critical", labels: {}, annotations: {}, startsAt: null }],
			},
			fakePorts(),
		);
		expect(request.isolateSettings).toBe(true);
	});
});

describe("storm path fan-out context assembly (issue #243 falsifier)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function armEnv(): void {
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
	}

	it("preserves M>1 alerts crossing via job payload data.alerts", async () => {
		armEnv();
		const { request } = await buildRequest(
			{
				incidentId: "inc-storm-1",
				investigationId: "inv-storm-1",
				alerts: [
					{ alertname: "HighCPU", severity: "critical", labels: { service: "checkout" }, annotations: {}, startsAt: null },
					{ alertname: "MemoryLeak", severity: "high", labels: { service: "checkout" }, annotations: {}, startsAt: null },
					{ alertname: "LatencySpike", severity: "medium", labels: { service: "checkout" }, annotations: {}, startsAt: null },
				],
			},
			fakePorts(),
		);
		expect(request.context?.alerts).toHaveLength(3);
		expect(request.context?.alerts[0].alertname).toBe("HighCPU");
		expect(request.context?.alerts[1].alertname).toBe("MemoryLeak");
		expect(request.context?.alerts[2].alertname).toBe("LatencySpike");
	});

	it("preserves M>1 alerts fetched from correlated incident DB rows when job alerts are omitted", async () => {
		armEnv();
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				id: "inc-storm-2",
				title: "Database Degradation Storm",
				severity: "critical",
				alerts: [
					{ id: "a1", title: "DB Connection Timeout", severity: "critical", labels: { service: "db" }, triggeredAt: "2026-07-31T10:00:00Z" },
					{ id: "a2", title: "DB Lock Contention", severity: "high", labels: { service: "db" }, triggeredAt: "2026-07-31T10:01:00Z" },
					{ id: "a3", title: "Disk I/O Saturated", severity: "critical", labels: { service: "db" }, triggeredAt: "2026-07-31T10:02:00Z" },
					{ id: "a4", title: "Replica Lag High", severity: "medium", labels: { service: "db" }, triggeredAt: "2026-07-31T10:03:00Z" },
				],
			})),
		});

		const { request } = await buildRequest(
			{ incidentId: "inc-storm-2", investigationId: "inv-storm-2" },
			ports,
		);

		expect(request.context?.alerts).toHaveLength(4);
		expect(request.context?.alerts.map((a) => a.alertname)).toEqual([
			"DB Connection Timeout",
			"DB Lock Contention",
			"Disk I/O Saturated",
			"Replica Lag High",
		]);
	});
});

/**
 * #331 — the harness working directory is resolved PER INVESTIGATION from the
 * incident's Service → `localCheckoutPath` mapping, closing #243 item 6 and
 * #238's per-alert-cwd deletion gate. These assert the whole precedence chain
 * ON THE RESOLVED REQUEST: mapping > PRISMALENS_INVESTIGATION_CWD > worker cwd,
 * plus the honesty requirement that an unmapped run says so.
 */
describe("buildRequest harness cwd (#331 service → local checkout)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function armEnv(): void {
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
	}

	// `annotations` and `startsAt` are REQUIRED on `FiringAlert`, not optional.
	const CHECKOUT_ALERT = {
		alertname: "HighCPU",
		severity: "critical",
		labels: { service: "checkout" },
		annotations: {},
		startsAt: null,
	};

	it("THE POINT OF #331: the investigation runs in the service's mapped checkout", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				title: "Checkout 5xx",
				service: { name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
			})),
		});
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-1", investigationId: "inv-cwd-1", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
		expect(checkout.source).toBe("service-mapping");
		expect(checkout.mapped).toBe(true);
	});

	it("the mapping BEATS PRISMALENS_INVESTIGATION_CWD (the env var is no longer primary)", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", "/srv/legacy-global");
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				title: "Checkout 5xx",
				service: { name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
			})),
		});
		const { request } = await buildRequest(
			{ incidentId: "inc-cwd-2", investigationId: "inv-cwd-2", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
	});

	it("per-alert parity: an incident with no service resolves via the alert's service label", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
			listServices: vi.fn(async () => [
				{ name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
			]),
		});
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-3", investigationId: "inv-cwd-3", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
		expect(checkout.mapped).toBe(true);
	});

	it("the incident's own service outranks a disagreeing alert label", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		// The correlator assigned this incident to "billing"; the alert is labelled
		// "checkout". Borrowing checkout's tree would be a silent wrong-dir run.
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({
				title: "Billing 5xx",
				service: { name: "billing", localCheckoutPath: null },
			})),
			listServices: vi.fn(async () => [
				{ name: "billing", localCheckoutPath: null },
				{ name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
			]),
		});
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-7", investigationId: "inv-cwd-7", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("billing");
	});

	it("a CONTAINS match on another service must not lend its checkout", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		// `listServices(search)` is a contains match — "checkout-legacy" contains
		// "checkout", and borrowing its tree would silently investigate the wrong code.
		const ports = fakePorts({
			getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })),
			listServices: vi.fn(async () => [
				{ name: "checkout-legacy", localCheckoutPath: "/home/dev/code/legacy" },
			]),
		});
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-4", investigationId: "inv-cwd-4", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.mapped).toBe(false);
	});

	it("unmapped: falls back to PRISMALENS_INVESTIGATION_CWD and SAYS it ran unmapped", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", "/srv/checkouts/checkout");
		const ports = fakePorts({ getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })) });
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-5", investigationId: "inv-cwd-5", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe("/srv/checkouts/checkout");
		expect(checkout.source).toBe("env-override");
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("UNMAPPED");
	});

	it("unmapped with no override: the worker's own cwd, still labelled unmapped", async () => {
		armEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		const ports = fakePorts({ getIncident: vi.fn(async () => ({ title: "Checkout 5xx" })) });
		const { request, checkout } = await buildRequest(
			{ incidentId: "inc-cwd-6", investigationId: "inv-cwd-6", alerts: [CHECKOUT_ALERT] },
			ports,
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.source).toBe("worker-cwd");
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("UNMAPPED");
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
});

describe("issue #501 — harness auth routes & selection (W4 tests)", () => {
	// Everything `buildRequest` and `resolveHarnessAuth` can read from the real
	// process environment, keyed to the value this block gives it by default.
	// This map IS the enumeration: the completeness test right below parses
	// both source files and fails if either references an env var (or
	// `os.homedir()`) that isn't a key here.
	const AMBIENT_ENV_DEFAULTS: Record<string, string | undefined> = {
		// buildRequest (packages/api/src/infrastructure/dispatch/investigation-run.ts)
		PRISMALENS_HARNESS: undefined,
		PRISMALENS_SANDBOX: undefined,
		PRISMALENS_INVESTIGATION_CWD: undefined,
		// resolveHarnessAuth / isOnPath (packages/@prismalens/config/src/harness-auth.ts)
		CLAUDE_CONFIG_DIR: undefined,
		PATH: "",
		PATHEXT: undefined,
		// The last fallback in `join(opts.homeDir ?? os.homedir(), ".claude")` —
		// not a `process.env.HOME` literal, so the regex scan below can't see
		// it; asserted separately in the completeness test.
		HOME: join(os.tmpdir(), "pl-w4-ambient-home-should-not-be-read"),
	};

	beforeEach(() => {
		for (const [name, value] of Object.entries(AMBIENT_ENV_DEFAULTS)) {
			vi.stubEnv(name, value);
		}
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("ambient-env enumeration above is complete (guards against a leak)", () => {
		const runSrc = readFileSync(
			fileURLToPath(new URL("./investigation-run.ts", import.meta.url)),
			"utf8",
		);
		const harnessAuthSrc = readFileSync(
			fileURLToPath(
				new URL(
					"../../../../@prismalens/config/src/harness-auth.ts",
					import.meta.url,
				),
			),
			"utf8",
		);

		const envRefs = new Set<string>();
		for (const src of [runSrc, harnessAuthSrc]) {
			for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
				envRefs.add(m[1]);
			}
		}
		const missing = [...envRefs].filter(
			(name) => !(name in AMBIENT_ENV_DEFAULTS),
		);
		expect(missing).toEqual([]);

		expect(harnessAuthSrc).toContain("os.homedir()");
		expect(AMBIENT_ENV_DEFAULTS.HOME).toBeDefined();
	});

	it("W4 case 1: session-only, credentials file present ⇒ verified, no unverified-session warning", async () => {
		const tempHome = join(
			os.tmpdir(),
			`pl-w4-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		const claudeDir = join(tempHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, ".credentials.json"),
			JSON.stringify({ token: "fixture-session" }),
		);
		const warnSpy = vi.spyOn(Logger.prototype, "warn");

		try {
			const ports = fakePorts({
				resolveLlm: vi.fn(async () => ({
					provider: null,
					model: null,
					baseUrl: null,
					credentials: {},
					harness: "auto",
				})),
			});

			const { request } = await buildRequest(
				{ incidentId: "inc-501-1", investigationId: "inv-501-1" },
				ports,
				{ harnessAuth: { homeDir: tempHome, isOnPath: (bin) => bin === "claude" } },
			);

			expect(request.harness).toBe("claude-code");
			expect(request.synth.configured).toBe(false);
			expect(request.model).toBeUndefined();
			expect(warnSpy).not.toHaveBeenCalledWith(
				expect.stringContaining("unverified"),
			);
		} finally {
			warnSpy.mockRestore();
			try {
				rmSync(tempHome, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	});

	it("W4 case 1b: session-only, credentials file absent ⇒ unverified session warning", async () => {
		const tempHome = join(
			os.tmpdir(),
			`pl-w4-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempHome, { recursive: true });
		const warnSpy = vi.spyOn(Logger.prototype, "warn");

		try {
			const ports = fakePorts({
				resolveLlm: vi.fn(async () => ({
					provider: null,
					model: null,
					baseUrl: null,
					credentials: {},
					harness: "auto",
				})),
			});

			const { request } = await buildRequest(
				{ incidentId: "inc-501-1b", investigationId: "inv-501-1b" },
				ports,
				{ harnessAuth: { homeDir: tempHome, isOnPath: (bin) => bin === "claude" } },
			);

			expect(request.harness).toBe("claude-code");
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("unverified"),
			);
		} finally {
			warnSpy.mockRestore();
			try {
				rmSync(tempHome, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	});

	it("W4 case 2: anthropic key, no session ⇒ unchanged behavior, synth.configured === true", async () => {
		const ports = fakePorts();
		const { request } = await buildRequest(
			{ incidentId: "inc-501-2", investigationId: "inv-501-2" },
			ports,
			{ harnessAuth: { isOnPath: () => false } },
		);

		expect(request.harness).toBe("claude-code");
		expect(request.synth.configured).toBe(true);
		expect(request.synth.apiKey).toBe(API_KEY);
	});

	// #518: this machine has no `claude` binary, so the message names the missing
	// binary, not a login.
	it("W4 case 3: nothing configured ⇒ throws naming the missing binary, not a login", async () => {
		const ports = fakePorts({
			resolveLlm: vi.fn(async () => ({
				provider: null,
				model: null,
				baseUrl: null,
				credentials: {},
				harness: "claude-code",
			})),
		});

		await expect(
			buildRequest(
				{ incidentId: "inc-501-3", investigationId: "inv-501-3" },
				ports,
				{ harnessAuth: { isOnPath: () => false } },
			),
		).rejects.toThrowError(
			/not found on PATH.*add an Anthropic API key in Settings/i,
		);

		await expect(
			buildRequest(
				{ incidentId: "inc-501-3", investigationId: "inv-501-3" },
				ports,
				{ harnessAuth: { isOnPath: () => false } },
			),
		).rejects.not.toThrowError(/claude \/login/i);
	});

	it("W4 case 4: PRISMALENS_HARNESS=bogus ⇒ throws naming valid ids", async () => {
		vi.stubEnv("PRISMALENS_HARNESS", "bogus");
		const ports = fakePorts();

		await expect(
			buildRequest(
				{ incidentId: "inc-501-4", investigationId: "inv-501-4" },
				ports,
			),
		).rejects.toThrowError(/Invalid PRISMALENS_HARNESS="bogus"/);
	});

	it("W4 case 5: setting deepagents + provider anthropic ⇒ protocol-mismatch error retained", async () => {
		const ports = fakePorts({
			resolveLlm: vi.fn(async () => ({
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				baseUrl: null,
				credentials: { anthropic: API_KEY },
				harness: "deepagents",
			})),
		});

		await expect(
			buildRequest(
				{ incidentId: "inc-501-5", investigationId: "inv-501-5" },
				ports,
			),
		).rejects.toThrowError(
			/Harness "deepagents" only supports OpenAI-protocol providers/,
		);
	});

	it("pinned claude-code with OpenAI synthesis does not receive foreign model id (#525)", async () => {
		const ports = fakePorts({
			resolveLlm: vi.fn(async () => ({
				provider: "openai",
				model: "gpt-5.4-mini",
				baseUrl: null,
				credentials: { openai: "sk-openai-key" },
				harness: "claude-code",
			})),
		});

		const { request } = await buildRequest(
			{ incidentId: "inc-525-2", investigationId: "inv-525-2" },
			ports,
			{ harnessAuth: { isOnPath: (bin) => bin === "claude" } },
		);

		expect(request.harness).toBe("claude-code");
		expect(request.model).toBeUndefined();
		expect(request.synth.model).toBe("gpt-5.4-mini");
		expect(request.synth.providerId).toBe("openai");
		expect(request.harnessEnv).toEqual({});
	});

	it("pinned deepagents with OpenAI synthesis receives compatible model id (#525)", async () => {
		const ports = fakePorts({
			resolveLlm: vi.fn(async () => ({
				provider: "openai",
				model: "gpt-5.4-mini",
				baseUrl: null,
				credentials: { openai: "sk-openai-key" },
				harness: "deepagents",
			})),
		});

		const { request } = await buildRequest(
			{ incidentId: "inc-525-3", investigationId: "inv-525-3" },
			ports,
			{ harnessAuth: { isOnPath: (bin) => bin === "deepagents-acp" } },
		);

		expect(request.harness).toBe("deepagents");
		expect(request.model).toBe("gpt-5.4-mini");
		expect(request.synth.model).toBe("gpt-5.4-mini");
		expect(request.synth.providerId).toBe("openai");
		expect(request.harnessEnv).toEqual({
			OPENAI_API_KEY: "sk-openai-key",
		});
	});
});
