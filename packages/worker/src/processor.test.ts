// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for `buildHarnessEnv` (ADR-0013 scope boundary): the `deepagents`
 * harness only speaks the OpenAI protocol via `OPENAI_*` env, so both
 * `OPENAI_API_KEY` and `OPENAI_BASE_URL` must be gated by provider — never leak a
 * non-OpenAI-shaped secret (anthropic/google/groq) into `OPENAI_API_KEY`
 * (worker-provider-hardwiring ledger item). No network / no LLM.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// `processor.ts` opens a real ioredis connection at module load (the canonical
// event publisher) — stub it so importing the module for this pure-function test
// stays hermetic (no network).
vi.mock("ioredis", () => ({
	// Vitest 4 requires a constructable implementation for `new Redis(...)`;
	// an arrow function is not a constructor, so use a `function`.
	Redis: vi.fn(function MockRedis() {
		return {
			publish: vi.fn(),
			quit: vi.fn(),
		};
	}),
}));

// `buildRequest` reads the incident over oRPC; stub the client so the request
// construction is exercised without a live API (a rejection is a caught no-incident
// path in the processor, which would silently weaken the assertion).
vi.mock("./orpc-client.js", () => ({
	api: { incidents: { get: vi.fn(async () => ({ title: "Checkout 5xx" })) } },
}));

const {
	buildHarnessEnv,
	speaksOpenAiProtocol,
	parseSandboxMode,
	harnessTakesSandbox,
	deriveWorkerAllowedHosts,
	buildRequest,
	default: processInvestigationJob,
} = await import("./processor.js");

const API_KEY = "secret-key";
const BASE_URL = "http://localhost:11434/v1";

describe("buildHarnessEnv (worker-provider-hardwiring)", () => {
	it("openai: sends OPENAI_API_KEY, no OPENAI_BASE_URL override", () => {
		expect(buildHarnessEnv("openai", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
		});
	});

	it("ollama: sends both OPENAI_API_KEY and OPENAI_BASE_URL (OpenAI-compatible)", () => {
		expect(buildHarnessEnv("ollama", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("custom: sends both OPENAI_API_KEY and OPENAI_BASE_URL (OpenAI-compatible)", () => {
		expect(buildHarnessEnv("custom", API_KEY, BASE_URL)).toEqual({
			OPENAI_API_KEY: API_KEY,
			OPENAI_BASE_URL: BASE_URL,
		});
	});

	it("anthropic: does NOT leak the anthropic key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("anthropic", API_KEY, BASE_URL)).toEqual({});
	});

	it("google: does NOT leak the google key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("google", API_KEY, BASE_URL)).toEqual({});
	});

	it("groq: does NOT leak the groq key into OPENAI_API_KEY", () => {
		expect(buildHarnessEnv("groq", API_KEY, BASE_URL)).toEqual({});
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

describe("harnessTakesSandbox (CLI-mirrored worker guard, ADR-0020/0017)", () => {
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
		// custom's allowedHosts is null → only telemetry hosts, deduped.
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
		vi.unstubAllGlobals();
	});

	/**
	 * Arm the two out-of-process reads `buildRequest` makes before it assembles the
	 * request: the internal LLM-credentials fetch and the harness/sandbox env knobs.
	 * `claude-code` + `process` is the combination that actually consumes
	 * `isolateSettings` (the ACP builder ignores it) and resolves no sandbox.
	 */
	function armWorkerEnv(): void {
		vi.stubEnv("PRISMALENS_INTERNAL_SECRET", "internal-secret");
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					baseUrl: null,
					credentials: { anthropic: API_KEY },
				}),
			})),
		);
	}

	// The regression this guards: an unattended server run that inherits the host
	// account's `~/.claude` executes its hooks and plugins ON THE HOST, outside the
	// boundary the worker resolved — and behaves unlike the CLI and unlike every eval.
	it("isolates host settings/hooks/plugins/MCP on the unattended server path", async () => {
		armWorkerEnv();
		const { request } = await buildRequest(
			{ incidentId: "inc-1", investigationId: "inv-1" },
			"run-1",
		);
		expect(request.isolateSettings).toBe(true);
	});

	// Isolation is a placement property, not a per-job one: no job payload may opt out.
	it("isolates regardless of the job payload", async () => {
		armWorkerEnv();
		const { request } = await buildRequest(
			{
				incidentId: "inc-2",
				investigationId: "inv-2",
				alerts: [{ alertname: "HighLatency", severity: "critical" }],
			},
			"run-2",
		);
		expect(request.isolateSettings).toBe(true);
	});
});

describe("storm path fan-out context assembly (issue #243 falsifier)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	function armWorkerEnv(): void {
		vi.stubEnv("PRISMALENS_INTERNAL_SECRET", "internal-secret");
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					baseUrl: null,
					credentials: { anthropic: API_KEY },
				}),
			})),
		);
	}

	it("preserves M>1 alerts crossing via job payload data.alerts", async () => {
		armWorkerEnv();
		const { request } = await buildRequest(
			{
				incidentId: "inc-storm-1",
				investigationId: "inv-storm-1",
				alerts: [
					{ alertname: "HighCPU", severity: "critical", labels: { service: "checkout" } },
					{ alertname: "MemoryLeak", severity: "high", labels: { service: "checkout" } },
					{ alertname: "LatencySpike", severity: "medium", labels: { service: "checkout" } },
				],
			},
			"run-storm-1",
		);
		expect(request.context?.alerts).toHaveLength(3);
		expect(request.context?.alerts[0].alertname).toBe("HighCPU");
		expect(request.context?.alerts[1].alertname).toBe("MemoryLeak");
		expect(request.context?.alerts[2].alertname).toBe("LatencySpike");
	});

	it("preserves M>1 alerts fetched from correlated incident DB rows when job alerts are omitted", async () => {
		armWorkerEnv();
		const { api } = await import("./orpc-client.js");
		type IncidentGetResult = Awaited<ReturnType<typeof api.incidents.get>>;
		vi.spyOn(api.incidents, "get").mockResolvedValueOnce({
			id: "inc-storm-2",
			title: "Database Degradation Storm",
			severity: "critical",
			alerts: [
				{
					id: "a1",
					title: "DB Connection Timeout",
					severity: "critical",
					labels: { service: "db" },
					triggeredAt: "2026-07-31T10:00:00Z",
				},
				{
					id: "a2",
					title: "DB Lock Contention",
					severity: "high",
					labels: { service: "db" },
					triggeredAt: "2026-07-31T10:01:00Z",
				},
				{
					id: "a3",
					title: "Disk I/O Saturated",
					severity: "critical",
					labels: { service: "db" },
					triggeredAt: "2026-07-31T10:02:00Z",
				},
				{
					id: "a4",
					title: "Replica Lag High",
					severity: "medium",
					labels: { service: "db" },
					triggeredAt: "2026-07-31T10:03:00Z",
				},
			],
		} as unknown as IncidentGetResult);

		const { request } = await buildRequest(
			{
				incidentId: "inc-storm-2",
				investigationId: "inv-storm-2",
			},
			"run-storm-2",
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
 * Issue #243 item 6 (per-alert cwd parity with `pl listen`) is DEFERRED, not
 * implemented: app mode has no source for a service→local-checkout mapping (the
 * DB records remote repos only, and the worker reads no `prismalens.config.yaml`
 * — that layer arrives with ADR-0014's D11 amendment at Phase 5). These lock the
 * honest behaviour in so a future config surface has to change a test to change
 * the contract, rather than a dead call silently pretending to resolve.
 */
describe("buildRequest harness cwd (app mode has no per-alert repo mapping)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	function armWorkerEnv(): void {
		vi.stubEnv("PRISMALENS_INTERNAL_SECRET", "internal-secret");
		vi.stubEnv("PRISMALENS_HARNESS", "claude-code");
		vi.stubEnv("PRISMALENS_SANDBOX", "process");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					baseUrl: null,
					credentials: { anthropic: API_KEY },
				}),
			})),
		);
	}

	it("falls back to the worker's own cwd — service labels do NOT steer it", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		const { request } = await buildRequest(
			{
				incidentId: "inc-cwd-1",
				investigationId: "inv-cwd-1",
				alerts: [
					{
						alertname: "HighCPU",
						severity: "critical",
						labels: { service: "checkout" },
					},
				],
			},
			"run-cwd-1",
		);
		expect(request.cwd).toBe(process.cwd());
	});

	it("honours the one explicit override, PRISMALENS_INVESTIGATION_CWD", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", "/srv/checkouts/checkout");
		const { request } = await buildRequest(
			{
				incidentId: "inc-cwd-2",
				investigationId: "inv-cwd-2",
				alerts: [
					{
						alertname: "HighCPU",
						severity: "critical",
						labels: { service: "checkout" },
					},
				],
			},
			"run-cwd-2",
		);
		expect(request.cwd).toBe("/srv/checkouts/checkout");
	});
});

describe("processInvestigationJob schema validation", () => {
	it("malformed job payload -> processor throws, not silent degradation", async () => {
		const malformedJob = {
			id: "job-malformed",
			name: "investigation",
			data: {
				// Missing required incidentId and investigationId
				priority: "invalid-priority",
			},
		};

		await expect(
			processInvestigationJob(malformedJob as any),
		).rejects.toThrow();
	});

	it("missing or absent alerts remains valid per schema", async () => {
		const validJobWithoutAlerts = {
			incidentId: "inc-123",
			investigationId: "inv-123",
		};
		const { InvestigationJobDataSchema } = await import(
			"@prismalens/contracts"
		);
		expect(() =>
			InvestigationJobDataSchema.parse(validJobWithoutAlerts),
		).not.toThrow();
	});
});


