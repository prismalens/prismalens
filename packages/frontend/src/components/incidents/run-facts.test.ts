// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RunRef } from "./record-context";
import { newerRunOf, runAccessLine, turnElapsed } from "./run-facts";

vi.mock("@/components/agent/AgentPicker", () => ({
	ModelChip: () => null,
	CHIP: "chip",
	EffortChip: () => null,
	AccessChip: () => null,
	defaultAccessOf: () => ({
		level: { level: "supervised", from: "prismalens" },
		mode: { mode: "execute", from: "prismalens" },
	}),
	modelName: (_h: unknown, id: string) => id,
	unreadyReason: () => null,
	useAgentChoice: () => ({
		harnesses: [],
		effective: undefined,
		model: "",
		efforts: {},
		axes: { accessLevels: {}, runModes: {}, autoAccessLevels: {}, autoRunModes: {} },
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

const makeRun = (id: string, createdAt: string): RunRef =>
	({
		id,
		createdAt,
		incidentId: "inc-1",
		status: "completed",
		kind: "investigation",
	}) as unknown as RunRef;

describe("newerRunOf", () => {
	it("returns the newest when an older one is selected", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "run-1")).toBe(newest);
	});

	it("returns null when the newest is selected", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "run-2")).toBeNull();
	});

	it("returns null when the selected id is unknown", () => {
		const newest = makeRun("run-2", "2026-10-09T14:00:00.000Z");
		const older = makeRun("run-1", "2026-10-09T12:00:00.000Z");
		const runs = [newest, older];

		expect(newerRunOf(runs, "unknown-run")).toBeNull();
	});
});

describe("runAccessLine (#673 w21 ruling 2026-10-10)", () => {
	const claudeHarness: HarnessStatus = {
		id: "claude-code",
		label: "Claude Code",
		binary: "claude",
		installed: true,
		tested: null,
		install: "",
		defaultModel: null,
		localDefault: { permission: null, mode: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		models: { source: "harness", asOf: "", entries: [] },
		checked: {
			at: "",
			outcome: "answers-acp",
			detail: "",
			servedModel: null,
			effort: null,
			modes: [
				{ id: "default", name: "Manual" },
				{ id: "acceptEdits", name: "Accept Edits" },
				{ id: "auto", name: "Auto" },
				{ id: "bypassPermissions", name: "Bypass Permissions" },
			],
			efforts: [],
			images: false,
			plan: true,
			sandbox: null,
		},
	};

	const codexHarness: HarnessStatus = {
		id: "codex",
		label: "Codex",
		binary: "codex",
		installed: true,
		tested: null,
		install: "",
		defaultModel: null,
		localDefault: { permission: null, mode: null },
		modelVia: "acp",
		loginHint: "",
		envModel: null,
		windowsOnlyPath: null,
		models: { source: "harness", asOf: "", entries: [] },
		checked: {
			at: "",
			outcome: "answers-acp",
			detail: "",
			servedModel: null,
			effort: null,
			modes: [
				{ id: "read-only", name: "Ask for approval" },
				{ id: "workspace-write", name: "Workspace write" },
			],
			efforts: [],
			images: false,
			plan: true,
			sandbox: null,
		},
	};

	it("formats 'Ask always (Manual)'", () => {
		const inv = {
			agentMode: "default",
			accessLevel: "supervised" as const,
			runMode: "execute" as const,
			harness: "claude-code",
		};
		expect(runAccessLine(inv, claudeHarness)).toBe("Ask always (Manual)");
	});

	it("formats 'Auto asked, ran in Auto-accept edits'", () => {
		const inv = {
			agentMode: "acceptEdits",
			accessLevel: "auto" as const,
			runMode: "execute" as const,
			harness: "claude-code",
			report: {
				fidelity: {
					mode: "acceptEdits",
					access: "auto" as const,
					ranAccess: "auto-edits" as const,
				},
			},
		} as Parameters<typeof runAccessLine>[0];
		expect(runAccessLine(inv, claudeHarness)).toBe(
			"Auto asked, ran in Auto-accept edits",
		);
	});

	it("formats 'Plan (Claude Code Plan)' on Claude Code (coupled harness)", () => {
		const inv = {
			agentMode: "plan",
			accessLevel: "supervised" as const,
			runMode: "plan" as const,
			harness: "claude-code",
		};
		expect(runAccessLine(inv, claudeHarness)).toBe("Plan (Claude Code Plan)");
	});

	it("formats 'Plan, Ask always (Ask for approval)' on Codex (uncoupled harness)", () => {
		const inv = {
			agentMode: "read-only",
			accessLevel: "supervised" as const,
			runMode: "plan" as const,
			harness: "codex",
		};
		expect(runAccessLine(inv, codexHarness)).toBe(
			"Plan, Ask always (Ask for approval)",
		);
	});

	it("formats #778 legacy row (no agentMode, fidelity has legacy level)", () => {
		const inv = {
			agentMode: null,
			accessLevel: undefined,
			runMode: undefined,
			harness: "codex",
			report: {
				fidelity: {
					mode: "read-only",
				},
			},
		} as Parameters<typeof runAccessLine>[0];
		expect(runAccessLine(inv, codexHarness)).toBe("Ask always");
	});

	it("formats #808 row (inv.agentMode set, but no accessLevel)", () => {
		const inv = {
			agentMode: "read-only",
			accessLevel: undefined,
			runMode: undefined,
			harness: "codex",
		};
		expect(runAccessLine(inv, codexHarness)).toBe("ran in Ask for approval");
	});
});

