// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	effectiveAccess,
	effectiveMode,
	HarnessSettingsSchema,
	HarnessStatusSchema,
	LocalDefaultSchema,
	UpdateHarnessSettingsSchema,
} from "./settings.js";

describe("UpdateHarnessSettingsSchema", () => {
	it("parses valid harness and models", () => {
		const parsed = UpdateHarnessSettingsSchema.parse({
			harness: "claude-code",
			models: { "claude-code": "claude-3-5-sonnet" },
		});
		expect(parsed).toEqual({
			harness: "claude-code",
			models: { "claude-code": "claude-3-5-sonnet" },
		});
	});

	it("rejects unknown keys like {harness, model} with strict validation", () => {
		const res = UpdateHarnessSettingsSchema.safeParse({
			harness: "claude-code",
			model: "claude-3-5-sonnet",
		});
		expect(res.success).toBe(false);
	});

	it("accepts null per key and rejects agentModes (strict)", () => {
		const parsed = UpdateHarnessSettingsSchema.parse({
			accessLevels: { "claude-code": null },
			runModes: { codex: null },
			autoAccessLevels: { gemini: null },
			autoRunModes: { opencode: null },
		});
		expect(parsed).toEqual({
			accessLevels: { "claude-code": null },
			runModes: { codex: null },
			autoAccessLevels: { gemini: null },
			autoRunModes: { opencode: null },
		});

		expect(
			UpdateHarnessSettingsSchema.safeParse({
				agentModes: { "claude-code": "default" },
			}).success,
		).toBe(false);
	});
});

describe("HarnessSettingsSchema", () => {
	it("accepts the four maps and strips agentModes", () => {
		const raw = {
			harness: "claude-code" as const,
			accessLevels: { "claude-code": "supervised" as const },
			runModes: { codex: "plan" as const },
			autoAccessLevels: { gemini: "auto" as const },
			autoRunModes: { opencode: "execute" as const },
			agentModes: { "claude-code": "default" },
		};
		const parsed = HarnessSettingsSchema.parse(raw);
		expect(parsed.accessLevels).toEqual({ "claude-code": "supervised" });
		expect(parsed.runModes).toEqual({ codex: "plan" });
		expect(parsed.autoAccessLevels).toEqual({ gemini: "auto" });
		expect(parsed.autoRunModes).toEqual({ opencode: "execute" });
		expect("agentModes" in parsed).toBe(false);
	});
});

describe("effectiveAccess and effectiveMode precedence", () => {
	it("follows autoStart true precedence: autoAccessLevels -> accessLevels -> local.level -> DEFAULT_ACCESS_LEVEL", () => {
		const s = {
			accessLevels: { "claude-code": "auto-edits" as const },
			autoAccessLevels: { "claude-code": "full-access" as const },
		};
		const local = {
			level: "auto" as const,
			file: "~/.claude/settings.json",
			value: "auto",
		};

		// 1. autoStart true with autoAccessLevels set
		expect(effectiveAccess(s, "claude-code", local, true)).toEqual({
			level: "full-access",
			from: "auto-settings",
		});

		// 2. autoStart true without autoAccessLevels falls back to accessLevels
		const sNoAuto = {
			accessLevels: { "claude-code": "auto-edits" as const },
		};
		expect(effectiveAccess(sNoAuto, "claude-code", local, true)).toEqual({
			level: "auto-edits",
			from: "settings",
		});

		// 3. autoStart true without any settings falls back to local.level
		expect(effectiveAccess({}, "claude-code", local, true)).toEqual({
			level: "auto",
			from: "agent",
		});

		// 4. autoStart true without local falls back to default
		expect(effectiveAccess({}, "claude-code", undefined, true)).toEqual({
			level: "supervised",
			from: "prismalens",
		});
		expect(
			effectiveAccess(
				{},
				"claude-code",
				{ level: null, file: "f", value: "v" },
				true,
			),
		).toEqual({
			level: "supervised",
			from: "prismalens",
		});
	});

	it("follows autoStart false precedence: accessLevels -> local.level -> DEFAULT_ACCESS_LEVEL (ignores autoAccessLevels)", () => {
		const s = {
			accessLevels: { "claude-code": "auto-edits" as const },
			autoAccessLevels: { "claude-code": "full-access" as const },
		};
		const local = {
			level: "auto" as const,
			file: "~/.claude/settings.json",
			value: "auto",
		};

		// 1. accessLevels wins over autoAccessLevels and local
		expect(effectiveAccess(s, "claude-code", local, false)).toEqual({
			level: "auto-edits",
			from: "settings",
		});

		// 2. without accessLevels, local.level wins
		expect(effectiveAccess({ autoAccessLevels: s.autoAccessLevels }, "claude-code", local, false)).toEqual({
			level: "auto",
			from: "agent",
		});

		// 3. fallback to default
		expect(effectiveAccess({}, "claude-code", undefined, false)).toEqual({
			level: "supervised",
			from: "prismalens",
		});
	});

	it("follows effectiveMode precedence for autoStart true and false", () => {
		const s = {
			runModes: { codex: "execute" as const },
			autoRunModes: { codex: "plan" as const },
		};
		const local = {
			mode: "plan" as const,
			file: "~/.codex/config.toml",
			value: "plan",
		};

		// autoStart true
		expect(effectiveMode(s, "codex", local, true)).toEqual({
			mode: "plan",
			from: "auto-settings",
		});
		expect(effectiveMode({ runModes: s.runModes }, "codex", local, true)).toEqual({
			mode: "execute",
			from: "settings",
		});
		expect(effectiveMode({}, "codex", local, true)).toEqual({
			mode: "plan",
			from: "agent",
		});
		expect(effectiveMode({}, "codex", undefined, true)).toEqual({
			mode: "execute",
			from: "prismalens",
		});

		// autoStart false
		expect(effectiveMode(s, "codex", local, false)).toEqual({
			mode: "execute",
			from: "settings",
		});
		expect(effectiveMode({ autoRunModes: s.autoRunModes }, "codex", local, false)).toEqual({
			mode: "plan",
			from: "agent",
		});
		expect(effectiveMode({}, "codex", undefined, false)).toEqual({
			mode: "execute",
			from: "prismalens",
		});
	});
});

describe("LocalDefaultSchema", () => {
	it("round-trips full, partial and null records losslessly", () => {
		const full = {
			permission: {
				level: "supervised" as const,
				file: "/etc/claude-code/managed-settings.json",
				value: "manual",
				reason: "managed policy",
			},
			mode: {
				mode: "execute" as const,
				file: "~/.claude/settings.json",
				value: "default",
			},
		};
		expect(LocalDefaultSchema.parse(full)).toEqual(full);

		const nullable = {
			permission: {
				level: null,
				file: "~/.gemini/settings.json",
				value: "auto_edit",
				reason: "cannot run untrusted",
			},
			mode: {
				mode: null,
				file: "~/.config/opencode/opencode.json",
				value: "unknown_agent",
			},
		};
		expect(LocalDefaultSchema.parse(nullable)).toEqual(nullable);

		const allNull = {
			permission: null,
			mode: null,
		};
		expect(LocalDefaultSchema.parse(allNull)).toEqual(allNull);
	});
});

describe("HarnessStatusSchema", () => {
	it("reads a status from an API older than envModel as having none", () => {
		const parsed = HarnessStatusSchema.parse({
			id: "claude-code",
			label: "Claude Code",
			binary: "claude",
			installed: true,
			tested: null,
			install: "npm i -g @anthropic-ai/claude-code",
			defaultModel: null,
			modelVia: "acp",
			loginHint: "claude login",
			models: { source: "catalogue", asOf: "2026-10-01", entries: [] },
		});
		expect(parsed.envModel).toBeNull();
	});
});
