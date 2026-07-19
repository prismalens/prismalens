// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { JSONRPCErrorException } from "json-rpc-2.0";
import { describe, expect, it } from "vitest";
import { parseInvestigateParams } from "./server.js";

/** Assert the parse throws a JSON-RPC -32602 (invalid params) exception. */
function expectInvalidParams(raw: unknown): void {
	let thrown: unknown;
	try {
		parseInvestigateParams(raw);
	} catch (err) {
		thrown = err;
	}
	expect(thrown).toBeInstanceOf(JSONRPCErrorException);
	expect((thrown as JSONRPCErrorException).code).toBe(-32602);
}

/**
 * The JSON-RPC `investigate` param coercion — the CLI/RPC parity surface (#148 item
 * 9). `sandbox` and `maxTurns` are the parity additions: the CLI has `--sandbox`
 * and `--max-turns`; the RPC host must be able to request them equivalently. A
 * SUPPLIED-but-malformed value throws `-32602` — absent is fine, invalid is never
 * silently swallowed (no silent config-fallback, no silently-removed cap).
 */
describe("parseInvestigateParams", () => {
	it("carries a valid sandbox mode through (CLI --sandbox parity)", () => {
		expect(parseInvestigateParams({ sandbox: "srt" }).sandbox).toBe("srt");
	});

	it("carries a positive integer maxTurns through (CLI --max-turns parity)", () => {
		expect(parseInvestigateParams({ maxTurns: 30 }).maxTurns).toBe(30);
	});

	it("throws -32602 on a supplied invalid sandbox (unknown mode, wrong type, empty)", () => {
		expectInvalidParams({ sandbox: "bogus-mode" });
		expectInvalidParams({ sandbox: 123 });
		expectInvalidParams({ sandbox: "" });
	});

	it("throws -32602 on a supplied invalid maxTurns (zero, negative, fractional, non-numeric)", () => {
		expectInvalidParams({ maxTurns: 0 });
		expectInvalidParams({ maxTurns: -1 });
		expectInvalidParams({ maxTurns: 1.5 });
		expectInvalidParams({ maxTurns: "30" });
	});

	it("leaves both unset when absent (config fallback is for ABSENT only)", () => {
		const out = parseInvestigateParams({ query: "x" });
		expect(out.sandbox).toBeUndefined();
		expect(out.maxTurns).toBeUndefined();
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
