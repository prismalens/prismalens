// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { describe, expect, it } from "vitest";
import type { ArmOptions } from "./ab-runner.js";
import { DENY_ALL_TOOLS, rungArmOptions } from "./ladder.js";

const baseOptions: ArmOptions = {
	cwd: "/tmp/substrate",
	model: "claude-sonnet-4-5",
	skillPluginPath: "/path/to/skill-plugin",
	maxTurns: 40,
	synth: {
		providerId: "ollama",
		model: "gpt-oss:120b",
		apiKey: "dummy",
		configured: true,
	},
};

describe("rungArmOptions", () => {
	it("configures L0 correctly (maxTurns: 1, no skill, disallowedTools: DENY_ALL_TOOLS)", () => {
		const opts = rungArmOptions("L0", baseOptions);
		expect(opts.maxTurns).toBe(1);
		expect(opts.skillPluginPath).toBeUndefined();
		expect(opts.disallowedTools).toEqual(DENY_ALL_TOOLS);
		expect(opts.cwd).toBe(baseOptions.cwd);
		expect(opts.model).toBe(baseOptions.model);
	});

	it("configures L1 correctly (no skill, tools on, original maxTurns)", () => {
		const opts = rungArmOptions("L1", baseOptions);
		expect(opts.maxTurns).toBe(40);
		expect(opts.skillPluginPath).toBeUndefined();
		expect(opts.disallowedTools).toBeUndefined();
		expect(opts.cwd).toBe(baseOptions.cwd);
		expect(opts.model).toBe(baseOptions.model);
	});

	it("configures L2 correctly (skill on, tools on, original maxTurns)", () => {
		const opts = rungArmOptions("L2", baseOptions);
		expect(opts.maxTurns).toBe(40);
		expect(opts.skillPluginPath).toBe(baseOptions.skillPluginPath);
		expect(opts.disallowedTools).toBeUndefined();
		expect(opts.cwd).toBe(baseOptions.cwd);
		expect(opts.model).toBe(baseOptions.model);
	});

	it("configures L3 correctly (skill on, tools on, original maxTurns)", () => {
		const opts = rungArmOptions("L3", baseOptions);
		expect(opts.maxTurns).toBe(40);
		expect(opts.skillPluginPath).toBe(baseOptions.skillPluginPath);
		expect(opts.disallowedTools).toBeUndefined();
		expect(opts.cwd).toBe(baseOptions.cwd);
		expect(opts.model).toBe(baseOptions.model);
	});
});

describe("DENY_ALL_TOOLS", () => {
	it("derives from HARNESS_REGISTRY and covers shell, file, search, web, and subagent tools", () => {
		const registryDeny = HARNESS_REGISTRY["claude-code"].readOnlyDeny ?? [];
		for (const tool of registryDeny) {
			expect(DENY_ALL_TOOLS).toContain(tool);
		}

		// Shell — including the background-shell companions
		expect(DENY_ALL_TOOLS).toContain("Bash");
		expect(DENY_ALL_TOOLS).toContain("BashOutput");
		expect(DENY_ALL_TOOLS).toContain("KillShell");
		// File read/write — the SDK's tool names, not aliases
		expect(DENY_ALL_TOOLS).toContain("Read");
		expect(DENY_ALL_TOOLS).toContain("Write");
		expect(DENY_ALL_TOOLS).toContain("Edit");
		expect(DENY_ALL_TOOLS).toContain("NotebookEdit");
		// Search
		expect(DENY_ALL_TOOLS).toContain("Glob");
		expect(DENY_ALL_TOOLS).toContain("Grep");
		// Web
		expect(DENY_ALL_TOOLS).toContain("WebFetch");
		expect(DENY_ALL_TOOLS).toContain("WebSearch");
		// Subagent + planning/bookkeeping
		expect(DENY_ALL_TOOLS).toContain("Task");
		expect(DENY_ALL_TOOLS).toContain("TodoWrite");
		expect(DENY_ALL_TOOLS).toContain("SlashCommand");
		expect(DENY_ALL_TOOLS).toContain("ExitPlanMode");
		// Found live in the L0 smoke: the deferred-tool loader leaks unless named.
		expect(DENY_ALL_TOOLS).toContain("ToolSearch");
	});
});
