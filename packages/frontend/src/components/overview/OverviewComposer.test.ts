// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { useAgentChoice } from "@/components/agent/AgentPicker";
import { boxChoice } from "./OverviewComposer";

type Choice = ReturnType<typeof useAgentChoice>;

const claude = { id: "claude-code", label: "Claude Code" };
const choice = {
	harnesses: [claude],
	effective: claude,
	model: "sonnet",
	models: { "claude-code": "sonnet" },
	efforts: {},
	axes: { accessLevels: {} },
} as unknown as Choice;

describe("boxChoice (#834 review)", () => {
	it("sends the agent the box shows when the draft's agent is gone", () => {
		const box = boxChoice(choice, {
			harness: "codex",
			model: "gpt-5",
			effort: "high",
			accessLevel: "supervised",
		});
		expect(box.harness).toBe(claude);
		expect(box.sent).toEqual({ accessLevel: "supervised", harness: "claude-code" });
		expect(box.model).toBe("sonnet");
	});

	it("sends the draft's own agent and model when it is there", () => {
		const box = boxChoice(choice, {
			harness: "claude-code",
			model: "opus",
			accessLevel: "supervised",
		});
		expect(box.sent).toEqual({
			accessLevel: "supervised",
			harness: "claude-code",
			model: "opus",
		});
	});
});
