// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { signInCommand, versionVsTested } from "./agent-status.js";

describe("signInCommand (#1171)", () => {
	const claudeRow = {
		binary: "claude",
		signInArgs: ["auth", "login"],
		configDir: { envKey: "CLAUDE_CONFIG_DIR", shownDefault: "~/.claude" },
	};

	it("win32 quotes binary path with single quotes doubled", () => {
		const cmd = signInCommand(claudeRow, {
			binaryPath: "C:\\Users\\O'Neil\\bin\\claude.exe",
			platform: "win32",
		});
		expect(cmd).toBe("& 'C:\\Users\\O''Neil\\bin\\claude.exe' auth login");
	});

	it("win32 doubles smart quotation marks in config dir preventing command injection", () => {
		const smartQuotes = ["\u2018", "\u2019", "\u201A", "\u201B"];
		for (const q of smartQuotes) {
			const cmd = signInCommand(claudeRow, {
				configDir: `C:\\dir${q}test`,
				platform: "win32",
			});
			expect(cmd).toBe(
				`$env:CLAUDE_CONFIG_DIR='C:\\dir${q}${q}test'; claude auth login`,
			);
		}

		// #1171: smart quote injection stays enclosed inside single-quoted string
		const injected = "C:\\a\u2019; Write-Output PWNED; #";
		const cmd = signInCommand(claudeRow, {
			configDir: injected,
			platform: "win32",
		});
		expect(cmd).toBe(
			"$env:CLAUDE_CONFIG_DIR='C:\\a\u2019\u2019; Write-Output PWNED; #'; claude auth login",
		);
		const match = /^\$env:[A-Za-z0-9_]+='(.*)'; (.*)$/.exec(cmd ?? "");
		expect(match).not.toBeNull();
		expect(match?.[1]).toBe("C:\\a\u2019\u2019; Write-Output PWNED; #");
		expect(match?.[2]).toBe("claude auth login");
		expect(match?.[2].split(";")).toHaveLength(1);
	});

	it("returns null when any value contains a control character", () => {
		expect(
			signInCommand(claudeRow, {
				binaryPath: "C:\\bin\\claude\n.exe",
				platform: "win32",
			}),
		).toBeNull();
		expect(
			signInCommand(
				{ ...claudeRow, signInArgs: ["auth", "login\u0000"] },
				{ platform: "win32" },
			),
		).toBeNull();
		expect(
			signInCommand(claudeRow, {
				configDir: "C:\\config\u007f",
				platform: "win32",
			}),
		).toBeNull();
	});

	it("posix quotes path with spaces and dollar signs and prefixes config env", () => {
		const cmd = signInCommand(claudeRow, {
			binaryPath: "/opt/my bin/$special/claude",
			configDir: "/home/user/$my config",
			platform: "linux",
		});
		expect(cmd).toBe(
			"CLAUDE_CONFIG_DIR='/home/user/$my config' '/opt/my bin/$special/claude' auth login",
		);
	});

	it("returns null without signInArgs and bare program name without binaryPath", () => {
		expect(
			signInCommand({ binary: "claude" }, { platform: "linux" }),
		).toBeNull();
		expect(
			signInCommand(claudeRow, { platform: "linux" }),
		).toBe("claude auth login");
		expect(
			signInCommand(claudeRow, { platform: "win32" }),
		).toBe("claude auth login");
	});
});

describe("versionVsTested (#1171)", () => {
	it("compares ran version against tested version", () => {
		expect(versionVsTested("0.163.0", "0.169.0")).toBe("older");
		expect(versionVsTested("2.1.323", "2.1.323")).toBe("same");
		expect(versionVsTested("2.3.0", "1.19.5")).toBe("newer");
		expect(versionVsTested(null, "1.0.0")).toBeNull();
		expect(versionVsTested("v1.2", "1.2.0")).toBe("same");
	});
});
