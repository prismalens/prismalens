// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the CLI sandbox guard (ADR-0020/0017), the mirror of the worker's
 * `harnessTakesSandbox`. The guard is a pure decision — no command run, no network — so we
 * exercise the extracted `resolveSandboxGuard` directly. The invariant under test: a mode
 * that DEMANDS an enforced boundary (`srt`/`e2b`) blocks a non-ACP harness, while `auto`
 * and `process` never do (an in-process harness just runs without a sandbox).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlConfigSchema } from "../config/schema.js";
import {
	collectAllowedDomains,
	resolveRunSandbox,
	resolveSandboxGuard,
} from "./investigate.js";

describe("resolveSandboxGuard (CLI sandbox guard, ADR-0020/0017)", () => {
	it("ACP harness (deepagents) hosts a sandbox in every mode, never blocked", () => {
		for (const mode of ["auto", "process", "srt", "e2b"] as const) {
			const g = resolveSandboxGuard("deepagents", mode);
			expect(g.takesSandbox).toBe(true);
			expect(g.blocked).toBe(false);
		}
	});

	// FIX 1: plain claude-code under the default `auto` (and `process`) is allowed — it runs
	// WITHOUT a sandbox (best-effort; the best for an in-process harness is none), not blocked.
	it("non-ACP harness under auto/process takes no sandbox and is NOT blocked", () => {
		for (const harness of ["claude-code", "codex"] as const) {
			for (const mode of ["auto", "process"] as const) {
				const g = resolveSandboxGuard(harness, mode);
				expect(g.takesSandbox).toBe(false);
				expect(g.blocked).toBe(false);
			}
		}
	});

	it("non-ACP harness is blocked ONLY on a mode that demands enforcement (srt/e2b)", () => {
		for (const harness of ["claude-code", "codex"] as const) {
			for (const mode of ["srt", "e2b"] as const) {
				const g = resolveSandboxGuard(harness, mode);
				expect(g.takesSandbox).toBe(false);
				expect(g.blocked).toBe(true);
			}
		}
	});
});

/**
 * The egress allowlist must cover every surface the harness ACTUALLY contacts (ADR-0020) —
 * the mirror of the worker's `deriveWorkerAllowedHosts`. The regression under test: the
 * allowlist used to read only explicitly-set config, omitting the harness's own LLM
 * endpoint AND the INVESTIGATION_DEFAULTS the request assembly falls back to — which hard-
 * denied the model call + default telemetry (every branch failed, no report).
 */
describe("collectAllowedDomains (egress allowlist, ADR-0020)", () => {
	let savedOllama: string | undefined;
	let savedOpenai: string | undefined;

	beforeEach(() => {
		// Neutralise a dev's real BYO-key base URLs so the default (ollama.com) is exercised.
		savedOllama = process.env.OLLAMA_BASE_URL;
		savedOpenai = process.env.OPENAI_BASE_URL;
		delete process.env.OLLAMA_BASE_URL;
		delete process.env.OPENAI_BASE_URL;
	});

	afterEach(() => {
		if (savedOllama === undefined) delete process.env.OLLAMA_BASE_URL;
		else process.env.OLLAMA_BASE_URL = savedOllama;
		if (savedOpenai === undefined) delete process.env.OPENAI_BASE_URL;
		else process.env.OPENAI_BASE_URL = savedOpenai;
	});

	it("includes the LLM endpoint + telemetry defaults when config sets nothing", () => {
		const hosts = collectAllowedDomains(PlConfigSchema.parse({}));
		expect(hosts).toContain("ollama.com"); // the harness's own model endpoint (default)
		expect(hosts).toContain("localhost"); // prometheus/alertmanager/api all default local
	});

	it("honors an OPENAI_BASE_URL env override for the LLM host", () => {
		process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
		const hosts = collectAllowedDomains(PlConfigSchema.parse({}));
		expect(hosts).toContain("api.openai.com");
	});

	it("prefers a configured telemetry host over the default, LLM host still present", () => {
		const hosts = collectAllowedDomains(
			PlConfigSchema.parse({
				telemetry: { prometheus_url: "http://prom.internal:9090" },
			}),
		);
		expect(hosts).toContain("prom.internal");
		expect(hosts).toContain("ollama.com");
	});

	it("folds a configured logs URL in and skips a malformed endpoint", () => {
		const hosts = collectAllowedDomains(
			PlConfigSchema.parse({
				logs: { url: "https://loki.example.com" },
				telemetry: { api_url: "not a url" },
			}),
		);
		expect(hosts).toContain("loki.example.com");
		expect(hosts).not.toContain("not a url");
	});
});

/**
 * The shared sandbox-resolution seam (ADR-0020/0017) both `investigate` and the JSON-RPC
 * `serve` path route through, so neither can silently drop enforcement. Only the guard
 * branches are hermetic (no srt spawn / egress probe): an enforced mode on a non-ACP
 * harness THROWS (the caller maps it to CLI-exit or a JSON-RPC error), and a non-ACP
 * harness under `auto`/`process` returns a null selection (it runs on the cooperative
 * floor, owning nothing to tear down). The ACP resolution path is covered by the engine's
 * `resolveSandbox` tests, not re-spawned here.
 */
describe("resolveRunSandbox (shared sandbox seam, ADR-0020/0017)", () => {
	const config = PlConfigSchema.parse({});

	it("throws for an enforced mode (srt/e2b) on a non-ACP harness", async () => {
		for (const harness of ["claude-code", "codex"] as const) {
			for (const mode of ["srt", "e2b"] as const) {
				await expect(resolveRunSandbox(harness, mode, config)).rejects.toThrow(
					/cannot run inside an enforced sandbox/,
				);
			}
		}
	});

	it("returns a null selection for a non-ACP harness under auto/process", async () => {
		for (const harness of ["claude-code", "codex"] as const) {
			for (const mode of ["auto", "process"] as const) {
				await expect(resolveRunSandbox(harness, mode, config)).resolves.toEqual(
					{ selection: null, degradeReason: null, degradeExpected: false },
				);
			}
		}
	});
});
