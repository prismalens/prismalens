/**
 * Hermetic tests for the CLI sandbox guard (ADR-0020/0017), the mirror of the worker's
 * `harnessTakesSandbox`. The guard is a pure decision — no command run, no network — so we
 * exercise the extracted `resolveSandboxGuard` directly. The invariant under test: a mode
 * that DEMANDS an enforced boundary (`srt`/`e2b`) blocks a non-ACP harness, while `auto`
 * and `process` never do (an in-process harness just runs without a sandbox).
 */
import { describe, expect, it } from "vitest";
import { resolveSandboxGuard } from "./investigate.js";

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
