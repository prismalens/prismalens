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
	tested: null,
	install: "",
	defaultModel: null,
	modelVia: "acp",
	loginHint: "",
	envModel: null,
	windowsOnlyPath: null,
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

	it("falls back to the agent default when nothing names a model", () => {
		expect(agentModelLabel(claudeCode, "").model).toBe("agent default");
	});
});
