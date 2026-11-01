// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { MAX_RUNNABLE_COMMAND_BYTES, runnableCommand } from "./terminal.js";

describe("runnableCommand", () => {
	it("accepts a plain one-line command", () => {
		expect(runnableCommand("pl doctor")).toBe(true);
		expect(
			runnableCommand("kubectl -n prod rollout undo deployment/checkout-api"),
		).toBe(true);
		expect(runnableCommand("echo 'héllo' | grep ü")).toBe(true);
	});

	it.each([
		["a newline", "ls\nrm -rf ~"],
		["a carriage return", "ls\r"],
		["a tab, which completes in the shell", "ls\t"],
		["Ctrl-O, which readline treats as accept-line", "printf x\u000f"],
		["ESC, which can end a bracketed paste", "\u001b[201~id"],
		["DEL", "ls\u007f"],
		["a C1 control", "ls\u009b"],
		["a line separator", "ls\u2028id"],
		["a bidi override", "ls \u202erm"],
		["a bidi isolate", "ls \u2066x"],
		["a NUL", "ls\u0000"],
	])("refuses %s", (_label, text) => {
		expect(runnableCommand(text)).toBe(false);
	});

	it("refuses blank and oversized text", () => {
		expect(runnableCommand("")).toBe(false);
		expect(runnableCommand("   ")).toBe(false);
		expect(runnableCommand("a".repeat(MAX_RUNNABLE_COMMAND_BYTES))).toBe(true);
		expect(runnableCommand("a".repeat(MAX_RUNNABLE_COMMAND_BYTES + 1))).toBe(
			false,
		);
		expect(runnableCommand("é".repeat(MAX_RUNNABLE_COMMAND_BYTES / 2 + 1))).toBe(
			false,
		);
	});
});
