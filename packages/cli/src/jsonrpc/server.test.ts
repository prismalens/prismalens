// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseInvestigateParams } from "./server.js";

/**
 * The JSON-RPC `investigate` param coercion — the CLI/RPC parity surface (#148 item
 * 9). `sandbox` and `maxTurns` are the parity additions: the CLI has `--sandbox`
 * and `--max-turns`; the RPC host must be able to request them equivalently. Invalid
 * sandbox VALUES are rejected in the handler (against SANDBOX_MODES), not here; this
 * layer only coerces shapes.
 */
describe("parseInvestigateParams", () => {
	it("carries sandbox through as a string (CLI --sandbox parity)", () => {
		expect(parseInvestigateParams({ sandbox: "srt" }).sandbox).toBe("srt");
	});

	it("carries a positive integer maxTurns through (CLI --max-turns parity)", () => {
		expect(parseInvestigateParams({ maxTurns: 30 }).maxTurns).toBe(30);
	});

	it("drops a non-string sandbox and a non-positive/non-integer maxTurns", () => {
		const out = parseInvestigateParams({
			sandbox: 123,
			maxTurns: -1,
		});
		expect(out.sandbox).toBeUndefined();
		expect(out.maxTurns).toBeUndefined();
		expect(parseInvestigateParams({ maxTurns: 1.5 }).maxTurns).toBeUndefined();
	});

	it("still coerces the pre-existing params", () => {
		const out = parseInvestigateParams({
			query: "why did it crash",
			harness: "deepagents",
			dangerouslySkipPermissions: true,
		});
		expect(out).toEqual({
			query: "why did it crash",
			harness: "deepagents",
			dangerouslySkipPermissions: true,
		});
	});
});
