// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { turnElapsed } from "./run-facts";

vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: () => null,
	CHIP: "chip",
	EffortChip: () => null,
	ModeChip: () => null,
	defaultModeOf: () => "agent-default",
	modelName: (_h: unknown, id: string) => id,
	unreadyReason: () => null,
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		efforts: {},
		agentModes: {},
	}),
}));

const T0 = Date.parse("2026-10-09T14:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const base = (s: number) => ({
	runId: "00000000-0000-0000-0000-000000000001",
	branchId: "run",
	path: [],
	seq: 1,
	label: null,
	ts: at(s),
});

describe("turnElapsed", () => {
	it("on a live run started 4h ago with a resumed operator_message 30s ago returns 30", () => {
		const now = T0 + 4 * 3600 * 1000;
		const run = {
			status: "running",
			createdAt: at(0),
			startedAt: at(0),
		};
		const resumedEvent = {
			kind: "operator_message" as const,
			...base(4 * 3600 - 30),
			text: "What next?",
			mode: "queue" as const,
			delivered: true,
			resumed: [{ name: "api", head: "1a2b3c4" }],
		} as CanonicalEvent;
		expect(turnElapsed(run, [resumedEvent], now)).toBe(30);
	});

	it("without that event returns the 4h figure", () => {
		const now = T0 + 4 * 3600 * 1000;
		const run = {
			status: "running",
			createdAt: at(0),
			startedAt: at(0),
		};
		expect(turnElapsed(run, [], now)).toBe(4 * 3600);
	});

	it("a completed run ignores the event and returns runElapsed", () => {
		const now = T0 + 4 * 3600 * 1000;
		const run = {
			status: "completed",
			createdAt: at(0),
			startedAt: at(0),
			completedAt: at(300),
		};
		const resumedEvent = {
			kind: "operator_message" as const,
			...base(270),
			text: "What next?",
			mode: "queue" as const,
			delivered: true,
			resumed: [{ name: "api", head: "1a2b3c4" }],
		} as CanonicalEvent;
		expect(turnElapsed(run, [resumedEvent], now)).toBe(300);
	});
});
