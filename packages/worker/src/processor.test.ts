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

// `buildRequest` reads the incident (and, for the #331 checkout mapping, the
// service catalog) over oRPC; stub the client so request construction is
// exercised without a live API (a rejection is a caught no-incident path in the
// processor, which would silently weaken the assertion).
//
// The stub is mutable via `apiState` so a test can say "this incident's service
// has THIS checkout mapped" and then assert the request carries it.
const apiState = vi.hoisted(() => ({
	incident: { title: "Checkout 5xx" } as Record<string, unknown>,
	services: [] as Array<{ name: string; localCheckoutPath: string | null }>,
}));

vi.mock("./orpc-client.js", () => ({
	api: {
		incidents: { get: vi.fn(async () => apiState.incident) },
		services: {
			list: vi.fn(async ({ search }: { search?: string }) => ({
				data: apiState.services.filter((s) =>
					search ? s.name.includes(search) : true,
				),
				total: apiState.services.length,
			})),
		},
		timeline: { create: vi.fn(async () => ({})) },
	},
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

	it("anthropic: sends ANTHROPIC_API_KEY only — never OPENAI_API_KEY", () => {
		// The claude-code harness reads its credential from ANTHROPIC_API_KEY; a plain
		// BYO key previously had no route in at all. Leaking it into OPENAI_API_KEY would
		// hand a harness a secret it cannot use.
		expect(buildHarnessEnv("anthropic", API_KEY, BASE_URL)).toEqual({
			ANTHROPIC_API_KEY: API_KEY,
		});
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
 * #331 — the harness working directory is resolved PER INVESTIGATION from the
 * incident's Service → `localCheckoutPath` mapping, closing #243 item 6 and
 * #238's per-alert-cwd deletion gate. These assert the whole precedence chain
 * ON THE RESOLVED REQUEST: mapping > PRISMALENS_INVESTIGATION_CWD > worker cwd,
 * plus the honesty requirement that an unmapped run says so.
 */
describe("buildRequest harness cwd (#331 service → local checkout)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		apiState.incident = { title: "Checkout 5xx" };
		apiState.services = [];
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

	const CHECKOUT_ALERT = {
		alertname: "HighCPU",
		severity: "critical",
		labels: { service: "checkout" },
	};

	it("THE POINT OF #331: the investigation runs in the service's mapped checkout", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		apiState.incident = {
			title: "Checkout 5xx",
			service: { name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
		};
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-1",
				investigationId: "inv-cwd-1",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-1",
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
		expect(checkout.source).toBe("service-mapping");
		expect(checkout.mapped).toBe(true);
	});

	it("the mapping BEATS PRISMALENS_INVESTIGATION_CWD (the env var is no longer primary)", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", "/srv/legacy-global");
		apiState.incident = {
			title: "Checkout 5xx",
			service: { name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
		};
		const { request } = await buildRequest(
			{
				incidentId: "inc-cwd-2",
				investigationId: "inv-cwd-2",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-2",
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
	});

	it("per-alert parity: an incident with no service resolves via the alert's service label", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		apiState.incident = { title: "Checkout 5xx" };
		apiState.services = [
			{ name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
		];
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-3",
				investigationId: "inv-cwd-3",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-3",
		);
		expect(request.cwd).toBe("/home/dev/code/checkout");
		expect(checkout.mapped).toBe(true);
	});

	it("the incident's own service outranks a disagreeing alert label", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		// The correlator assigned this incident to "billing"; the alert is labelled
		// "checkout". Borrowing checkout's tree would be a silent wrong-dir run.
		apiState.incident = {
			title: "Billing 5xx",
			service: { name: "billing", localCheckoutPath: null },
		};
		apiState.services = [
			{ name: "billing", localCheckoutPath: null },
			{ name: "checkout", localCheckoutPath: "/home/dev/code/checkout" },
		];
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-7",
				investigationId: "inv-cwd-7",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-7",
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("billing");
	});

	it("a CONTAINS match on another service must not lend its checkout", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		apiState.incident = { title: "Checkout 5xx" };
		// `list({ search })` is a contains match — "checkout-legacy" contains
		// "checkout", and borrowing its tree would silently investigate the wrong code.
		apiState.services = [
			{ name: "checkout-legacy", localCheckoutPath: "/home/dev/code/legacy" },
		];
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-4",
				investigationId: "inv-cwd-4",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-4",
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.mapped).toBe(false);
	});

	it("unmapped: falls back to PRISMALENS_INVESTIGATION_CWD and SAYS it ran unmapped", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", "/srv/checkouts/checkout");
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-5",
				investigationId: "inv-cwd-5",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-5",
		);
		expect(request.cwd).toBe("/srv/checkouts/checkout");
		expect(checkout.source).toBe("env-override");
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("UNMAPPED");
	});

	it("unmapped with no override: the worker's own cwd, still labelled unmapped", async () => {
		armWorkerEnv();
		vi.stubEnv("PRISMALENS_INVESTIGATION_CWD", undefined);
		const { request, checkout } = await buildRequest(
			{
				incidentId: "inc-cwd-6",
				investigationId: "inv-cwd-6",
				alerts: [CHECKOUT_ALERT],
			},
			"run-cwd-6",
		);
		expect(request.cwd).toBe(process.cwd());
		expect(checkout.source).toBe("worker-cwd");
		expect(checkout.mapped).toBe(false);
		expect(checkout.note).toContain("UNMAPPED");
	});
});

describe("processInvestigationJob schema validation", () => {
	it("malformed job payload -> processor throws, not silent degradation", async () => {
		const job = {
			id: "job-malformed",
			name: "investigation",
			attemptsMade: 0,
			updateProgress: vi.fn(async () => {}),
		};
		const malformedData = {
			// Missing required incidentId and investigationId
			priority: "invalid-priority",
		};

		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: the point is an invalid payload.
			processInvestigationJob(job, malformedData as any, {
				emit: vi.fn(),
				streamDone: vi.fn(),
				signal: new AbortController().signal,
			}),
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


