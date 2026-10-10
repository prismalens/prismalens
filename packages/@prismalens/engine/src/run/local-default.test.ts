// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { localDefault } from "./local-default.js";

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), `pl-ld-${name}-`)));

const write = (path: string, content: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
	return path;
};

const FIXTURES_DIR = join(__dirname, "__fixtures__", "local-default");

describe("localDefault", () => {
	describe("Claude Code", () => {
		it("maps each known defaultMode row per §3 including aliases and case insensitivity", () => {
			const home = tmp("claude-modes");
			const userDir = join(home, ".claude");
			const settingsFile = join(userDir, "settings.json");

			const cases: Array<{
				raw: string;
				expectedLevel: "supervised" | "auto-edits" | "auto" | "full-access" | null;
				expectedMode: "execute" | "plan" | null;
			}> = [
				{ raw: "default", expectedLevel: "supervised", expectedMode: "execute" },
				{ raw: "manual", expectedLevel: "supervised", expectedMode: "execute" },
				{ raw: "Manual", expectedLevel: "supervised", expectedMode: "execute" },
				{ raw: "acceptEdits", expectedLevel: "auto-edits", expectedMode: "execute" },
				{ raw: "acceptedits", expectedLevel: "auto-edits", expectedMode: "execute" },
				{ raw: "AcceptEdits", expectedLevel: "auto-edits", expectedMode: "execute" },
				{ raw: "auto", expectedLevel: "auto", expectedMode: "execute" },
				{ raw: "AUTO", expectedLevel: "auto", expectedMode: "execute" },
				{ raw: "bypassPermissions", expectedLevel: "full-access", expectedMode: "execute" },
				{ raw: "bypasspermissions", expectedLevel: "full-access", expectedMode: "execute" },
				{ raw: "bypass", expectedLevel: "full-access", expectedMode: "execute" },
				{ raw: "Bypass", expectedLevel: "full-access", expectedMode: "execute" },
				{ raw: "plan", expectedLevel: null, expectedMode: "plan" },
				{ raw: "Plan", expectedLevel: null, expectedMode: "plan" },
				{ raw: "dontAsk", expectedLevel: null, expectedMode: "execute" },
				{ raw: "dontask", expectedLevel: null, expectedMode: "execute" },
				{ raw: "unknown-value", expectedLevel: null, expectedMode: null },
			];

			for (const c of cases) {
				write(settingsFile, JSON.stringify({ permissions: { defaultMode: c.raw } }));
				const res = localDefault("claude-code", { HOME: home }, { claudeManagedDir: null });
				expect(res.permission).toEqual({
					level: c.expectedLevel,
					file: "~/.claude/settings.json",
					value: c.raw,
				});
				expect(res.mode).toEqual({
					mode: c.expectedMode,
					file: "~/.claude/settings.json",
					value: c.raw,
				});
			}
		});

		it("prefers Claude managed settings over user settings and respects CLAUDE_CONFIG_DIR", () => {
			const home = tmp("claude-precedence");
			const managedDir = tmp("claude-managed");
			const customConfigDir = tmp("claude-custom-config");

			write(join(managedDir, "managed-settings.json"), JSON.stringify({ permissions: { defaultMode: "auto" } }));
			write(join(customConfigDir, "settings.json"), JSON.stringify({ permissions: { defaultMode: "manual" } }));
			write(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "bypass" } }));

			// Managed wins over user
			const managedRes = localDefault(
				"claude-code",
				{ HOME: home, CLAUDE_CONFIG_DIR: customConfigDir },
				{ claudeManagedDir: managedDir },
			);
			expect(managedRes.permission?.level).toBe("auto");
			expect(managedRes.permission?.file).toBe(join(managedDir, "managed-settings.json"));

			// When managed has no setting, CLAUDE_CONFIG_DIR wins over ~/.claude/settings.json
			const userRes = localDefault(
				"claude-code",
				{ HOME: home, CLAUDE_CONFIG_DIR: customConfigDir },
				{ claudeManagedDir: null },
			);
			expect(userRes.permission?.level).toBe("supervised");
			expect(userRes.permission?.value).toBe("manual");
			expect(userRes.permission?.file).toBe(join(customConfigDir, "settings.json"));

			// When CLAUDE_CONFIG_DIR is absent, ~/.claude/settings.json is used
			const defaultUserRes = localDefault("claude-code", { HOME: home }, { claudeManagedDir: null });
			expect(defaultUserRes.permission?.level).toBe("full-access");
			expect(defaultUserRes.permission?.value).toBe("bypass");
			expect(defaultUserRes.permission?.file).toBe("~/.claude/settings.json");
		});

		it("loads from fixture files", () => {
			const home = tmp("claude-fixture-home");
			const managedDir = tmp("claude-fixture-managed");
			copyFileSync(join(FIXTURES_DIR, "claude-managed.json"), join(managedDir, "managed-settings.json"));
			copyFileSync(join(FIXTURES_DIR, "claude-user.json"), join(home, "settings.json"));

			const res = localDefault("claude-code", { HOME: home, CLAUDE_CONFIG_DIR: home }, { claudeManagedDir: managedDir });
			expect(res.permission?.level).toBe("auto");
		});
	});

	describe("Codex", () => {
		it("maps each (sandbox_mode, approval_policy) pair per §3", () => {
			const home = tmp("codex-pairs");
			const configFile = join(home, ".codex", "config.toml");

			const pairs: Array<{
				sandbox?: string;
				approval?: string;
				expectedLevel: "supervised" | "auto-edits" | "full-access" | null;
				expectedValue: string;
			}> = [
				// on-request or absent approval
				{ sandbox: "read-only", approval: undefined, expectedLevel: "supervised", expectedValue: "read-only" },
				{ sandbox: "read-only", approval: "on-request", expectedLevel: "supervised", expectedValue: "read-only, on-request" },
				{ sandbox: "workspace-write", approval: undefined, expectedLevel: "auto-edits", expectedValue: "workspace-write" },
				{ sandbox: "workspace-write", approval: "on-request", expectedLevel: "auto-edits", expectedValue: "workspace-write, on-request" },
				{ sandbox: "danger-full-access", approval: undefined, expectedLevel: "full-access", expectedValue: "danger-full-access" },
				{ sandbox: "danger-full-access", approval: "on-request", expectedLevel: "full-access", expectedValue: "danger-full-access, on-request" },
				// never, untrusted, or other -> null
				{ sandbox: "read-only", approval: "never", expectedLevel: null, expectedValue: "read-only, never" },
				{ sandbox: "workspace-write", approval: "never", expectedLevel: null, expectedValue: "workspace-write, never" },
				{ sandbox: "danger-full-access", approval: "never", expectedLevel: null, expectedValue: "danger-full-access, never" },
				{ sandbox: "workspace-write", approval: "untrusted", expectedLevel: null, expectedValue: "workspace-write, untrusted" },
				{ sandbox: "workspace-write", approval: "other-policy", expectedLevel: null, expectedValue: "workspace-write, other-policy" },
				// unrecognized sandbox_mode
				{ sandbox: "unknown-sandbox", approval: "on-request", expectedLevel: null, expectedValue: "unknown-sandbox, on-request" },
			];

			for (const p of pairs) {
				const lines = [];
				if (p.sandbox) lines.push(`sandbox_mode = "${p.sandbox}"`);
				if (p.approval) lines.push(`approval_policy = "${p.approval}"`);
				write(configFile, lines.join("\n"));

				const res = localDefault("codex", { HOME: home });
				expect(res.permission).toEqual({
					level: p.expectedLevel,
					file: "~/.codex/config.toml",
					value: p.expectedValue,
				});
				expect(res.mode).toBeNull();
			}
		});

		it("supports CODEX_HOME and profile override", () => {
			const home = tmp("codex-override-home");
			const codexHome = tmp("codex-custom-home");

			// Profile override in config.toml
			write(
				join(codexHome, "config.toml"),
				`
profile = "fast"
sandbox_mode = "read-only"
approval_policy = "never"

[profiles.fast]
sandbox_mode = "workspace-write"
approval_policy = "on-request"
`,
			);

			const res = localDefault("codex", { HOME: home, CODEX_HOME: codexHome });
			expect(res.permission).toEqual({
				level: "auto-edits",
				file: join(codexHome, "config.toml"),
				value: "workspace-write, on-request",
			});
			expect(res.mode).toBeNull();
		});

		it("returns null when sandbox_mode is missing", () => {
			const home = tmp("codex-no-sandbox");
			write(join(home, ".codex", "config.toml"), 'approval_policy = "on-request"\n');
			const res = localDefault("codex", { HOME: home });
			expect(res).toEqual({ permission: null, mode: null });
		});

		it("loads from fixture file", () => {
			const home = tmp("codex-fixture-home");
			const codexHome = join(home, ".codex");
			mkdirSync(codexHome, { recursive: true });
			copyFileSync(join(FIXTURES_DIR, "codex-config.toml"), join(codexHome, "config.toml"));

			// Default profile from top-level
			const res = localDefault("codex", { HOME: home });
			expect(res.permission?.level).toBe("auto-edits");
			expect(res.permission?.value).toBe("workspace-write, on-request");

			// With profile = "power"
			write(
				join(codexHome, "config.toml"),
				`profile = "power"\n` + write(join(codexHome, "config.toml"), "") /* clear */,
			);
			copyFileSync(join(FIXTURES_DIR, "codex-config.toml"), join(codexHome, "config.toml"));
			const content = `profile = "power"\n` + write(join(codexHome, "config.toml"), "");
			const fixtureContent = readFileSync(join(FIXTURES_DIR, "codex-config.toml"), "utf8");
			write(join(codexHome, "config.toml"), `profile = "power"\n${fixtureContent}`);
			const resPower = localDefault("codex", { HOME: home });
			expect(resPower.permission?.level).toBe("full-access");
			expect(resPower.permission?.value).toBe("danger-full-access, on-request");
		});
	});

	describe("Gemini CLI", () => {
		it("maps default, auto_edit, and plan per §3", () => {
			const home = tmp("gemini-modes");
			const settingsFile = join(home, ".gemini", "settings.json");

			// default
			write(settingsFile, JSON.stringify({ general: { defaultApprovalMode: "default" } }));
			const resDefault = localDefault("gemini", { HOME: home }, { geminiSystemFile: null });
			expect(resDefault.permission).toEqual({
				level: "supervised",
				file: "~/.gemini/settings.json",
				value: "default",
			});
			expect(resDefault.mode).toEqual({
				mode: "execute",
				file: "~/.gemini/settings.json",
				value: "default",
			});

			// auto_edit -> level null with reason
			write(settingsFile, JSON.stringify({ general: { defaultApprovalMode: "auto_edit" } }));
			const resAutoEdit = localDefault("gemini", { HOME: home }, { geminiSystemFile: null });
			expect(resAutoEdit.permission).toEqual({
				level: null,
				file: "~/.gemini/settings.json",
				value: "auto_edit",
				reason: "Gemini CLI runs the copy untrusted here",
			});
			expect(resAutoEdit.mode).toEqual({
				mode: "execute",
				file: "~/.gemini/settings.json",
				value: "auto_edit",
			});

			// plan
			write(settingsFile, JSON.stringify({ general: { defaultApprovalMode: "plan" } }));
			const resPlan = localDefault("gemini", { HOME: home }, { geminiSystemFile: null });
			expect(resPlan.permission).toEqual({
				level: null,
				file: "~/.gemini/settings.json",
				value: "plan",
			});
			expect(resPlan.mode).toEqual({
				mode: "plan",
				file: "~/.gemini/settings.json",
				value: "plan",
			});

			// other string
			write(settingsFile, JSON.stringify({ general: { defaultApprovalMode: "custom-mode" } }));
			const resOther = localDefault("gemini", { HOME: home }, { geminiSystemFile: null });
			expect(resOther.permission).toEqual({
				level: null,
				file: "~/.gemini/settings.json",
				value: "custom-mode",
			});
			expect(resOther.mode).toEqual({
				mode: null,
				file: "~/.gemini/settings.json",
				value: "custom-mode",
			});
		});

		it("prefers system settings over user settings and respects GEMINI_CLI_HOME", () => {
			const home = tmp("gemini-home");
			const customHome = tmp("gemini-cli-home");
			const systemFile = join(tmp("gemini-sys"), "settings.json");

			write(systemFile, JSON.stringify({ general: { defaultApprovalMode: "plan" } }));
			write(join(customHome, ".gemini", "settings.json"), JSON.stringify({ general: { defaultApprovalMode: "default" } }));
			write(join(home, ".gemini", "settings.json"), JSON.stringify({ general: { defaultApprovalMode: "auto_edit" } }));

			// System overrides user
			const resSys = localDefault(
				"gemini",
				{ HOME: home, GEMINI_CLI_HOME: customHome },
				{ geminiSystemFile: systemFile },
			);
			expect(resSys.mode?.mode).toBe("plan");
			expect(resSys.mode?.file).toBe(systemFile);

			// Without system, GEMINI_CLI_HOME overrides HOME
			const resUser = localDefault(
				"gemini",
				{ HOME: home, GEMINI_CLI_HOME: customHome },
				{ geminiSystemFile: null },
			);
			expect(resUser.permission?.level).toBe("supervised");
			expect(resUser.permission?.file).toBe(join(customHome, ".gemini", "settings.json"));
		});

		it("loads from fixture file", () => {
			const home = tmp("gemini-fixture-home");
			const settingsFile = join(home, ".gemini", "settings.json");
			mkdirSync(dirname(settingsFile), { recursive: true });
			copyFileSync(join(FIXTURES_DIR, "gemini-settings.json"), settingsFile);

			const res = localDefault("gemini", { HOME: home }, { geminiSystemFile: null });
			expect(res.permission?.level).toBe("supervised");
			expect(res.mode?.mode).toBe("execute");
		});
	});

	describe("OpenCode", () => {
		it("supports .jsonc with comments, config.json, and precedence", () => {
			const home = tmp("opencode-home");
			const configDir = join(home, ".config", "opencode");

			// .jsonc with comments
			write(
				join(configDir, "opencode.jsonc"),
				`{
					// default agent setting
					"default_agent": "plan",
				}`,
			);
			const resJsonc = localDefault("opencode", { HOME: home });
			expect(resJsonc.permission).toBeNull();
			expect(resJsonc.mode).toEqual({
				mode: "plan",
				file: "~/.config/opencode/opencode.jsonc",
				value: "plan",
			});

			// opencode.json takes precedence over opencode.jsonc
			write(
				join(configDir, "opencode.json"),
				JSON.stringify({ default_agent: "build" }),
			);
			const resJson = localDefault("opencode", { HOME: home });
			expect(resJson.mode).toEqual({
				mode: "execute",
				file: "~/.config/opencode/opencode.json",
				value: "build",
			});

			// config.json used when opencode.json and opencode.jsonc are absent
			const home2 = tmp("opencode-home2");
			write(
				join(home2, ".config", "opencode", "config.json"),
				JSON.stringify({ default_agent: "build" }),
			);
			const resConfig = localDefault("opencode", { HOME: home2 });
			expect(resConfig.mode).toEqual({
				mode: "execute",
				file: "~/.config/opencode/config.json",
				value: "build",
			});
		});

		it("respects XDG_CONFIG_HOME and ignores OPENCODE_CONFIG", () => {
			const home = tmp("opencode-env-home");
			const xdg = tmp("opencode-xdg");
			const ignored = tmp("opencode-ignored");

			write(join(xdg, "opencode", "opencode.json"), JSON.stringify({ default_agent: "plan" }));
			write(join(ignored, "opencode.json"), JSON.stringify({ default_agent: "build" }));

			const res = localDefault("opencode", {
				HOME: home,
				XDG_CONFIG_HOME: xdg,
				OPENCODE_CONFIG: join(ignored, "opencode.json"),
			});
			expect(res.mode).toEqual({
				mode: "plan",
				file: join(xdg, "opencode", "opencode.json"),
				value: "plan",
			});
		});

		it("loads from fixture file", () => {
			const home = tmp("opencode-fixture-home");
			const configDir = join(home, ".config", "opencode");
			mkdirSync(configDir, { recursive: true });
			copyFileSync(join(FIXTURES_DIR, "opencode.jsonc"), join(configDir, "opencode.jsonc"));

			const res = localDefault("opencode", { HOME: home });
			expect(res.mode?.mode).toBe("plan");
			expect(res.mode?.value).toBe("plan");
		});
	});

	describe("error handling and deepagents", () => {
		it("returns NONE when key is missing", () => {
			const home = tmp("missing-keys");
			write(join(home, ".claude", "settings.json"), JSON.stringify({}));
			write(join(home, ".gemini", "settings.json"), JSON.stringify({}));
			write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({}));

			expect(localDefault("claude-code", { HOME: home }, { claudeManagedDir: null })).toEqual({
				permission: null,
				mode: null,
			});
			expect(localDefault("gemini", { HOME: home }, { geminiSystemFile: null })).toEqual({
				permission: null,
				mode: null,
			});
			expect(localDefault("opencode", { HOME: home })).toEqual({
				permission: null,
				mode: null,
			});
		});

		it("returns NONE and logs debug message on bad JSON and bad TOML", () => {
			const home = tmp("bad-files");
			const debugMsgs: string[] = [];
			const onDebug = (m: string) => debugMsgs.push(m);

			write(join(home, ".claude", "settings.json"), "{ invalid json ");
			write(join(home, ".codex", "config.toml"), "invalid toml == [");
			write(join(home, ".gemini", "settings.json"), "{ broken json ");
			write(join(home, ".config", "opencode", "opencode.json"), "{ bad json ");

			expect(localDefault("claude-code", { HOME: home }, { claudeManagedDir: null, onDebug })).toEqual({
				permission: null,
				mode: null,
			});
			expect(localDefault("codex", { HOME: home }, { onDebug })).toEqual({
				permission: null,
				mode: null,
			});
			expect(localDefault("gemini", { HOME: home }, { geminiSystemFile: null, onDebug })).toEqual({
				permission: null,
				mode: null,
			});
			expect(localDefault("opencode", { HOME: home }, { onDebug })).toEqual({
				permission: null,
				mode: null,
			});

			expect(debugMsgs.some((m) => m.includes(".codex/config.toml"))).toBe(true);
			expect(debugMsgs.some((m) => m.includes(".gemini/settings.json"))).toBe(true);
			expect(debugMsgs.some((m) => m.includes(".config/opencode/opencode.json"))).toBe(true);
		});

		it("returns both null for deepagents without reading anything", () => {
			expect(localDefault("deepagents")).toEqual({
				permission: null,
				mode: null,
			});
		});
	});
});
