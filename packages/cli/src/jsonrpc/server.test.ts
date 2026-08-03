// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { consola } from "consola";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { describe, expect, it, vi } from "vitest";
import { logJsonRpcDispatchError, parseInvestigateParams } from "./server.js";

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

/**
 * #192 — JSON-RPC dispatch-failure logging must not treat an expected CLIENT
 * input error (JSONRPCErrorException, e.g. -32602 invalid sandbox) the same as a
 * genuinely unexpected failure. Expected errors get one WARN line; unexpected
 * errors keep the full stack-trace path unchanged.
 */
describe("logJsonRpcDispatchError", () => {
	it("logs a single WARN line for a JSONRPCErrorException, never consola.error", () => {
		const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => consola);
		const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => consola);
		const message =
			'An unexpected error occurred while executing "investigate" JSON-RPC method:';
		const err = new JSONRPCErrorException('Invalid sandbox mode "bogus".', -32602);

		logJsonRpcDispatchError(message, err);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(`${message} ${err.message}`);
		expect(errorSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("keeps the stack-trace path (consola.error) for a genuinely unexpected error", () => {
		const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => consola);
		const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => consola);
		const err = new Error("boom");

		logJsonRpcDispatchError(
			'An unexpected error occurred while executing "investigate" JSON-RPC method:',
			err,
		);

		expect(errorSpy).toHaveBeenCalledWith(expect.any(String), err);
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("keeps the stack-trace path for a JSONRPCErrorException carrying INTERNAL_ERROR (-32603)", () => {
		const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => consola);
		const errorSpy = vi.spyOn(consola, "error").mockImplementation(() => consola);
		const message =
			'An unexpected error occurred while executing "investigate" JSON-RPC method:';
		const err = new JSONRPCErrorException("investigation produced no evidence", -32603);

		logJsonRpcDispatchError(message, err);

		expect(errorSpy).toHaveBeenCalledWith(message, err);
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
