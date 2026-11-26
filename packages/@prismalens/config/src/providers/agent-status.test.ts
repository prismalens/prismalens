// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	agentCommand,
	installChannelOf,
	signInCommand,
	updateRoute,
	versionVsTested,
} from "./agent-status.js";
import { HARNESS_REGISTRY } from "./harness.js";

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

describe("agentCommand (#1180)", () => {
	const codex = HARNESS_REGISTRY.codex;
	const claude = HARNESS_REGISTRY["claude-code"];

	it("stages each agent's sign-out and change-account lines on linux and win32", () => {
		const lines = (["claude-code", "codex", "opencode", "gemini"] as const).map(
			(id) => {
				const row = HARNESS_REGISTRY[id];
				const at = (args: readonly string[] | undefined, platform: string) =>
					args ? agentCommand(row, args, { platform }) : null;
				return [
					id,
					at(row.signOutArgs, "linux"),
					at(row.switchAccountArgs, "linux"),
					at(row.switchAccountArgs, "win32"),
				];
			},
		);
		expect(lines).toEqual([
			["claude-code", "claude auth logout", "claude auth login", "claude auth login"],
			["codex", "codex logout", "codex login", "codex login"],
			["opencode", "opencode auth logout", null, null],
			["gemini", null, "gemini -i '/auth signin'", "gemini -i '/auth signin'"],
		]);
	});

	it("sets the config folder before the program, in each shell's own syntax", () => {
		const opts = { configDir: "/home/o'n/.codex", binaryPath: "/opt/codex" };
		expect(agentCommand(codex, ["logout"], { ...opts, platform: "linux" })).toBe(
			`CODEX_HOME="/home/o'n/.codex" /opt/codex logout`,
		);
		expect(
			agentCommand(codex, ["logout"], {
				configDir: "C:\\Users\\o'n\\.codex",
				binaryPath: "C:\\bin\\codex.cmd",
				platform: "win32",
			}),
		).toBe("$env:CODEX_HOME='C:\\Users\\o''n\\.codex'; & 'C:\\bin\\codex.cmd' logout");
	});

	it("signInCommand is agentCommand over the row's sign-in args", () => {
		expect(signInCommand(claude, { platform: "linux" })).toBe(
			agentCommand(claude, ["auth", "login"], { platform: "linux" }),
		);
	});
});

describe("installChannelOf (#1180)", () => {
	const brew = { cask: "codex" };

	it("a Windows npm shim lies in the prefix itself, matched without case", () => {
		const prefix = "C:\\Users\\o\\AppData\\Roaming\\npm";
		expect(
			installChannelOf(
				{
					path: "c:\\users\\o\\appdata\\roaming\\npm\\codex.CMD",
					realPath: "c:\\users\\o\\appdata\\roaming\\npm\\codex.CMD",
				},
				{ npmPrefix: prefix, brewPrefix: null },
				brew,
				"win32",
			),
		).toBe("npm");
	});

	it("a custom prefix on linux: the bin link or its target in lib/node_modules", () => {
		const where = { npmPrefix: "/home/o/.npm-global", brewPrefix: null };
		expect(
			installChannelOf(
				{
					path: "/usr/local/bin/codex",
					realPath: "/home/o/.npm-global/lib/node_modules/@openai/codex/bin/codex.js",
				},
				where,
				brew,
				"linux",
			),
		).toBe("npm");
		expect(
			installChannelOf(
				{ path: "/home/o/.npm-global/bin/codex", realPath: "/elsewhere/codex" },
				where,
				brew,
				"linux",
			),
		).toBe("npm");
		// Case matters off Windows: another folder is not npm's.
		expect(
			installChannelOf(
				{ path: "/home/o/.NPM-global/bin/codex", realPath: "/x/codex" },
				where,
				brew,
				"linux",
			),
		).toBeNull();
	});

	it("a Homebrew cask or formula path names the brew upgrade", () => {
		const where = { npmPrefix: "/usr/local", brewPrefix: "/opt/homebrew" };
		const cask = installChannelOf(
			{
				path: "/opt/homebrew/bin/codex",
				realPath: "/opt/homebrew/Caskroom/codex/0.171.0/codex-aarch64-apple-darwin",
			},
			where,
			brew,
			"darwin",
		);
		expect(cask).toEqual({ cask: "codex" });
		expect(updateRoute(HARNESS_REGISTRY.codex, cask, { platform: "darwin" })).toEqual({
			command: "brew upgrade --cask codex",
		});
		const formula = installChannelOf(
			{
				path: "/opt/homebrew/bin/gemini",
				realPath: "/opt/homebrew/Cellar/gemini-cli/0.65.0/libexec/bin/gemini",
			},
			where,
			{ formula: "gemini-cli" },
			"darwin",
		);
		expect(formula).toEqual({ formula: "gemini-cli" });
		expect(updateRoute(HARNESS_REGISTRY.gemini, formula, { platform: "darwin" })).toEqual({
			command: "brew upgrade gemini-cli",
		});
	});

	it("an unknown path shows the agent's own update line, never another install's command", () => {
		const found = installChannelOf(
			{ path: "/home/o/bin/gemini", realPath: "/home/o/bin/gemini" },
			{ npmPrefix: "/usr/local", brewPrefix: "/opt/homebrew" },
			{ formula: "gemini-cli" },
			"linux",
		);
		expect(found).toBeNull();
		expect(updateRoute(HARNESS_REGISTRY.gemini, found, { platform: "linux" })).toEqual({
			line: "Download the latest release from github.com/google-gemini/gemini-cli/releases",
		});
	});

	it("Codex on an unknown path runs its own `codex update`; a found channel still wins", () => {
		expect(
			updateRoute(HARNESS_REGISTRY.codex, null, {
				platform: "linux",
				binaryPath: "/home/o/bin/codex",
			}),
		).toEqual({ command: "/home/o/bin/codex update" });
		expect(updateRoute(HARNESS_REGISTRY.codex, "npm", { platform: "linux" })).toEqual({
			command: "npm i -g @openai/codex@latest",
		});
	});
});

describe("updateRoute (#1180)", () => {
	it("npm installs take the pinned package at latest", () => {
		expect(updateRoute(HARNESS_REGISTRY.codex, "npm", { platform: "win32" })).toEqual({
			command: "npm i -g @openai/codex@latest",
		});
		expect(updateRoute(HARNESS_REGISTRY.gemini, "npm", { platform: "linux" })).toEqual({
			command: "npm i -g @google/gemini-cli@latest",
		});
	});

	it("an agent with its own updater runs it whatever the channel", () => {
		expect(
			updateRoute(HARNESS_REGISTRY["claude-code"], "npm", {
				platform: "win32",
				binaryPath: "C:\\tools\\claude.exe",
			}),
		).toEqual({ command: "& 'C:\\tools\\claude.exe' update" });
		expect(updateRoute(HARNESS_REGISTRY.opencode, null, { platform: "linux" })).toEqual({
			command: "opencode upgrade",
		});
	});

	it("no line on the row falls back to the generic words", () => {
		expect(
			updateRoute({ binary: "x", configDir: undefined }, null, { platform: "linux" }),
		).toEqual({ line: "Update it the way you installed it" });
	});
});
