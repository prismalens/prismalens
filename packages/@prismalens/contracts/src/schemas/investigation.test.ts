/**
 * Hermetic parse round-trip for the structured honest-fidelity sandbox field
 * (ADR-0017 honest fidelity + ADR-0020 Sandbox port, B.1.1 follow-up):
 * `RunFidelitySchema.sandbox` is ADDITIVE — a run with no boundary wired must
 * still parse, and a run with one wired must round-trip losslessly. No
 * network/LLM.
 */
import { describe, expect, it } from "vitest";
import { RunFidelitySchema } from "./investigation.js";

describe("RunFidelitySchema (ADR-0017/ADR-0020 sandbox field)", () => {
	it("parses without a sandbox (no boundary wired — e.g. the in-process harness)", () => {
		const input = {
			harness: "claude-code",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism: "native permission flags",
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed.sandbox).toBeUndefined();
		expect(parsed).toEqual(input);
	});

	it("round-trips with a sandbox — requested === actual (no degrade)", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism:
				"native permission flags · sandbox=process-floor (cooperative)",
			sandbox: {
				requested: "process",
				actual: "process-floor",
				fidelity: "cooperative",
			},
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed).toEqual(input);
	});

	it("round-trips with a sandbox — requested !== actual (the auto-degrade case)", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism:
				"native permission flags · sandbox=process-floor (cooperative)",
			sandbox: {
				requested: "auto",
				actual: "process-floor",
				fidelity: "cooperative",
			},
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed).toEqual(input);
		expect(parsed.sandbox?.requested).not.toBe(parsed.sandbox?.actual);
	});

	it("rejects an unknown sandbox.fidelity value (only enforced|cooperative — no 'advisory')", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism: "x",
			sandbox: { requested: "auto", actual: "srt", fidelity: "advisory" },
		};
		expect(() => RunFidelitySchema.parse(input)).toThrow();
	});
});
