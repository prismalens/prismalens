// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveOnPath: vi.fn(() => null as string | null) }));
vi.mock("@prismalens/config/harness-selection", () => ({
	resolveOnPath: mocks.resolveOnPath,
}));

const { escapeArgument, escapeCommand, windowsSpawnPlan } = await import("./windows-spawn.js");

afterEach(() => {
	mocks.resolveOnPath.mockReset();
	mocks.resolveOnPath.mockReturnValue(null);
});

describe("windowsSpawnPlan (#634 — npm .cmd/.bat shims can't execve on Windows)", () => {
	it("re-plans a .cmd command through cmd.exe with verbatim args", () => {
		const plan = windowsSpawnPlan("opencode.cmd", ["acp", "--pure"], "win32");
		expect(plan).toEqual({
			command: process.env.ComSpec ?? "cmd.exe",
			args: ["/d", "/s", "/c", '"opencode.cmd ^^^"acp^^^" ^^^"--pure^^^""'],
			options: { windowsVerbatimArguments: true },
		});
	});

	it("re-plans a .bat command the same way, case-insensitively", () => {
		const plan = windowsSpawnPlan("Foo.BAT", [], "win32");
		expect(plan.command).toBe(process.env.ComSpec ?? "cmd.exe");
		expect(plan.args).toEqual(["/d", "/s", "/c", '"Foo.BAT"']);
	});

	it("re-plans when the bare command isn't a shim but its resolved PATH copy is", () => {
		mocks.resolveOnPath.mockReturnValue("C:\\npm\\opencode.cmd");
		const plan = windowsSpawnPlan("opencode", ["acp"], "win32");
		expect(plan.command).toBe(process.env.ComSpec ?? "cmd.exe");
		expect(plan.args).toEqual([
			"/d",
			"/s",
			"/c",
			`"${escapeCommand("C:\\npm\\opencode.cmd")} ^^^"acp^^^""`,
		]);
		expect(mocks.resolveOnPath).toHaveBeenCalledWith("opencode");
	});

	it("quotes and ^-escapes a token with a space and a cmd metacharacter", () => {
		const plan = windowsSpawnPlan(
			"foo.cmd",
			["C:\\Program Files\\a & b.txt"],
			"win32",
		);
		expect(plan.args).toEqual([
			"/d",
			"/s",
			"/c",
			'"foo.cmd ^^^"C:\\Program^^^ Files\\a^^^ ^^^&^^^ b.txt^^^""',
		]);
	});

	it("is identity on linux, even for a .cmd-looking command", () => {
		const plan = windowsSpawnPlan("opencode.cmd", ["acp"], "linux");
		expect(plan).toEqual({ command: "opencode.cmd", args: ["acp"], options: {} });
	});

	it("is identity on win32 for a non-shim command not resolved to one either", () => {
		const plan = windowsSpawnPlan("opencode.exe", ["acp"], "win32");
		expect(plan).toEqual({ command: "opencode.exe", args: ["acp"], options: {} });
	});
});

describe("windowsSpawnPlan cross-spawn quoting compliance", () => {
	const crossSpawnRequire = createRequire(import.meta.url);
	const crossSpawnEscape = crossSpawnRequire("cross-spawn/lib/util/escape.js") as {
		command: (cmd: string) => string;
		argument: (arg: string, doubleEscape: boolean) => string;
	};

	const testCases = [
		"a&b",
		"C:\\dir with space\\",
		'he said "x"',
		"%PATH%",
		"a|b^c",
	];

	for (const input of testCases) {
		it(`matches cross-spawn escaping for '${input}'`, () => {
			const plan = windowsSpawnPlan("test.cmd", [input], "win32");
			const expectedLine = `test.cmd ${crossSpawnEscape.argument(input, true)}`;
			expect(plan.args).toEqual(["/d", "/s", "/c", `"${expectedLine}"`]);
		});
	}

	it("matches cross-spawn escaping when all test cases are combined in one command", () => {
		const plan = windowsSpawnPlan("test.cmd", testCases, "win32");
		const expectedLine = [
			crossSpawnEscape.command("test.cmd"),
			...testCases.map((arg) => crossSpawnEscape.argument(arg, true)),
		].join(" ");
		expect(plan.args).toEqual(["/d", "/s", "/c", `"${expectedLine}"`]);
	});
});

describe("escapeCommand and escapeArgument (cross-spawn port)", () => {
	it("leaves a plain command untouched", () => {
		expect(escapeCommand("opencode")).toBe("opencode");
	});

	it("escapes cmd metacharacters in a command", () => {
		expect(escapeCommand("foo & bar.cmd")).toBe("foo^ ^&^ bar.cmd");
	});

	it("wraps an argument in quotes and escapes metacharacters with double escape for shims", () => {
		expect(escapeArgument("hello world", true)).toBe('^^^"hello^^^ world^^^"');
	});

	it("backslash-escapes an embedded quote and doubles backslashes before quote", () => {
		expect(escapeArgument('say "hi"', true)).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
	});
});

