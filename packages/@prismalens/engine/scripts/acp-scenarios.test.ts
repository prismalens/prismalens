// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import type { Row } from "../../../../scripts/fakes/scripted-model.mjs";
import { checkRow, expectationFor, type RowObservation } from "./acp-scenarios.js";

const cancelled = {
	kind: "error",
	message: "investigation cancelled",
} as unknown as CanonicalEvent;

const seen = (orphan: boolean): RowObservation => ({
	events: [cancelled],
	elapsedMs: 5000,
	agentSpoke: true,
	files: {},
	neverRan: false,
	orphan,
});

describe("checkRow cancelled-orphaned (#914)", () => {
	it("passes while the cancelled tool's process outlives the run", () => {
		expect(checkRow("deepagents", "cancelled-orphaned", seen(true))).toBeNull();
	});

	it("fails once the agent stops the process, so the fix is noticed", () => {
		expect(checkRow("deepagents", "cancelled-orphaned", seen(false))).toMatch(
			/known failure is fixed/,
		);
	});

	it("leaves `cancelled` failing on an orphan", () => {
		expect(checkRow("deepagents", "cancelled", seen(true))).toMatch(
			/outlived the run/,
		);
	});
});

describe("expectationFor a row that observes a source-read fact", () => {
	const row = {
		row: "brief-placement",
		expect: "report",
		fact: { name: "systemPromptVia", value: "claude-meta", else: "error" },
	} as unknown as Row;

	it("expects the report of the agent that declares the fact, and the error of every other", () => {
		expect(expectationFor(row, "claude-code")).toEqual({
			expect: "report",
			why: "systemPromptVia is claude-meta",
		});
		expect(expectationFor(row, "codex")).toEqual({
			expect: "error",
			why: "systemPromptVia is not declared",
		});
	});

	it("lets an agent's own entry win over the fact", () => {
		const own = { ...row, agents: { codex: { expect: "exited", why: "x" } } } as unknown as Row;
		expect(expectationFor(own, "codex")).toEqual({ expect: "exited", why: "x" });
	});
});
