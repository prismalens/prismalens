// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	effectiveAccess,
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

	it("accepts null per key and rejects agentModes and runModes (strict)", () => {
		const parsed = UpdateHarnessSettingsSchema.parse({
			accessLevels: { "claude-code": null },
			autoAccessLevels: { gemini: null },
		});
		expect(parsed).toEqual({
			accessLevels: { "claude-code": null },
			autoAccessLevels: { gemini: null },
		});

		expect(
			UpdateHarnessSettingsSchema.safeParse({
				agentModes: { "claude-code": "default" },
			}).success,
		).toBe(false);
		expect(
			UpdateHarnessSettingsSchema.safeParse({ runModes: { codex: "plan" } })
				.success,
		).toBe(false);
	});
});

describe("HarnessSettingsSchema", () => {
	it("accepts both level maps and strips agentModes and legacy run modes", () => {
		const raw = {
			harness: "claude-code" as const,
			accessLevels: { "claude-code": "supervised" as const },
			runModes: { codex: "plan" },
			autoAccessLevels: { gemini: "auto" as const },
			autoRunModes: { opencode: "execute" },
			agentModes: { "claude-code": "default" },
		};
		const parsed = HarnessSettingsSchema.parse(raw);
		expect(parsed.accessLevels).toEqual({ "claude-code": "supervised" });
		expect(parsed.autoAccessLevels).toEqual({ gemini: "auto" });
		expect("agentModes" in parsed).toBe(false);
		expect("runModes" in parsed).toBe(false);
		expect("autoRunModes" in parsed).toBe(false);
	});
});

describe("effectiveAccess precedence", () => {
	it("follows autoStart true precedence: autoAccessLevels -> Auto (ignores accessLevels and local.level)", () => {
		const s = {
			accessLevels: { "claude-code": "auto-edits" as const },
			autoAccessLevels: { "claude-code": "full-access" as const },
		};
		const local = {
			level: "supervised" as const,
			file: "~/.claude/settings.json",
			value: "default",
		};

		// 1. autoStart true with autoAccessLevels set
		expect(effectiveAccess(s, "claude-code", local, true)).toEqual({
			level: "full-access",
			from: "auto-settings",
		});

		// 2. autoStart true without autoAccessLevels is Auto, whatever the next-run chain says
		expect(
			effectiveAccess(
				{ accessLevels: s.accessLevels },
				"claude-code",
				local,
				true,
			),
		).toEqual({ level: "auto", from: "prismalens" });
		expect(effectiveAccess({}, "claude-code", local, true)).toEqual({
			level: "auto",
			from: "prismalens",
		});
		expect(effectiveAccess({}, "claude-code", undefined, true)).toEqual({
			level: "auto",
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
		};
		expect(LocalDefaultSchema.parse(full)).toEqual(full);

		const nullable = {
			permission: {
				level: null,
				file: "~/.gemini/settings.json",
				value: "auto_edit",
				reason: "cannot run untrusted",
			},
		};
		expect(LocalDefaultSchema.parse(nullable)).toEqual(nullable);

		const allNull = {
			permission: null,
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
