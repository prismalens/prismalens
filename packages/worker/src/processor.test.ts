/**
 * Hermetic tests for `buildHarnessEnv` (ADR-0013 scope boundary): the `deepagents`
 * harness only speaks the OpenAI protocol via `OPENAI_*` env, so both
 * `OPENAI_API_KEY` and `OPENAI_BASE_URL` must be gated by provider — never leak a
 * non-OpenAI-shaped secret (anthropic/google/groq) into `OPENAI_API_KEY`
 * (worker-provider-hardwiring ledger item). No network / no LLM.
 */
import { describe, expect, it, vi } from "vitest";

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

const {
	buildHarnessEnv,
	speaksOpenAiProtocol,
	parseSandboxMode,
	harnessTakesSandbox,
	deriveWorkerAllowedHosts,
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
