// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the honest-fidelity sandbox guard (ADR-0017/ADR-0020): a
 * sandbox may only be claimed when the harness actually consumes it. Only
 * ACP-transport harnesses are spawned as a child the engine can place inside the
 * boundary — accepting one for the in-process Agent SDK harness would record an
 * enforcement that never applied. No network/LLM.
 */
import { describe, expect, it } from "vitest";
import { createProcessFloorSandbox } from "../sandbox/process-floor.js";
import { resolveInvestigation } from "./resolve.js";

const BASE_REQUEST = {
	alert: { name: "HighErrorRate", labels: { service: "checkout" } },
	telemetry: { prometheusUrl: "http://localhost:9090" },
	cwd: process.cwd(),
	synth: { providerId: "openai", model: "gpt-5-mini", apiKey: "test-key" },
} as const;

describe("resolveInvestigation sandbox guard (ADR-0017 honest fidelity)", () => {
	it("threads a sandbox for the ACP harness and names it in the mechanism", () => {
		const sandbox = createProcessFloorSandbox();
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "deepagents",
			sandbox,
		});
		expect(resolved.fidelity.mechanism).toContain(
			"sandbox=process-floor (cooperative)",
		);
	});

	it("threads a sandbox for the Claude Code harness and names it in the mechanism and fidelity", () => {
		const sandbox = createProcessFloorSandbox();
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "claude-code",
			sandbox,
		});
		expect(resolved.fidelity.mechanism).toContain(
			"sandbox=process-floor (cooperative)",
		);
		expect(resolved.fidelity.sandbox).toEqual({
			requested: "process-floor",
			actual: "process-floor",
			fidelity: "cooperative",
		});
	});

	it("does not claim any sandbox in the mechanism when none is wired", () => {
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "deepagents",
		});
		expect(resolved.fidelity.mechanism).not.toContain("sandbox=");
	});
});

describe("resolveInvestigation deepagents inert-native guard (ADR-0017 honest fidelity)", () => {
	it("rejects deepagents native.sandbox — the flag was dropped, not silently ignored", () => {
		expect(() =>
			resolveInvestigation({
				...BASE_REQUEST,
				harness: "deepagents",
				harnessNative: { sandbox: true },
			}),
		).toThrow(/no longer maps to anything|--sandbox/);
	});

	it("rejects deepagents native.shellAllowList for the same reason", () => {
		expect(() =>
			resolveInvestigation({
				...BASE_REQUEST,
				harness: "deepagents",
				harnessNative: { shellAllowList: ["git", "ls"] },
			}),
		).toThrow(/shellAllowList/);
	});

	it("still accepts a benign deepagents native passthrough (args)", () => {
		expect(() =>
			resolveInvestigation({
				...BASE_REQUEST,
				harness: "deepagents",
				harnessNative: { args: ["--verbose"] },
			}),
		).not.toThrow();
	});
});

describe("resolveInvestigation structured fidelity.sandbox (ADR-0020 B.1.1 follow-up)", () => {
	it("is absent when no sandbox is wired", () => {
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "deepagents",
		});
		expect(resolved.fidelity.sandbox).toBeUndefined();
	});

	it("defaults requested to the sandbox id when the caller didn't separately know the request", () => {
		const sandbox = createProcessFloorSandbox();
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "deepagents",
			sandbox,
		});
		expect(resolved.fidelity.sandbox).toEqual({
			requested: "process-floor",
			actual: "process-floor",
			fidelity: "cooperative",
		});
	});

	it("reports requested !== actual for the auto-degrade case (requested=auto, actual=process-floor)", () => {
		// Simulates the CLI/worker path: `resolveSandbox("auto")` degraded to the
		// floor because srt was unavailable; the caller threads its OWN requested
		// mode string alongside the resolved (degraded) sandbox.
		const sandbox = createProcessFloorSandbox();
		const resolved = resolveInvestigation({
			...BASE_REQUEST,
			harness: "deepagents",
			sandbox,
			requestedSandbox: "auto",
		});
		expect(resolved.fidelity.sandbox).toEqual({
			requested: "auto",
			actual: "process-floor",
			fidelity: "cooperative",
		});
	});
});
