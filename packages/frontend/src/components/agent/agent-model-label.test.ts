// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { agentModelLabel } from "./AgentPicker";

const claudeCode: HarnessStatus = {
	id: "claude-code",
	label: "Claude Code",
	binary: "claude-agent-acp",
	installed: true,
	runnable: true,
	tested: null,
	install: "",
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
	cliBinary: "",
	configDir: null,
	providerKeys: [],
	envVars: [],
	models: { source: "catalogue", asOf: "2026-10-01", entries: [] },
};

describe("agentModelLabel", () => {
	it("names a gateway's env model when no model is set (walk f18)", () => {
		const effective = {
			...claudeCode,
			envModel: { key: "ANTHROPIC_MODEL", model: "gemma4:31b-cloud" },
		};
		expect(agentModelLabel(effective, "").model).toBe("gemma4:31b-cloud");
	});

	it("names the list's first model when nothing reports one, never a default (#907)", () => {
		const listed = {
			...claudeCode,
			models: {
				...claudeCode.models,
				entries: [{ id: "claude-sonnet-5-5", name: "Sonnet 5.5", status: null }],
			},
		};
		expect(agentModelLabel(listed, "").model).toBe("Sonnet 5.5");
		expect(agentModelLabel(claudeCode, "").model).toBe("its own model");
	});
});
