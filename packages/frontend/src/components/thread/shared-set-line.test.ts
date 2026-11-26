// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SharedSet } from "@prismalens/contracts/schemas";
import { describe, expect, it } from "vitest";
import { SHARED_SET_COMPACT_LINE, sharedSetLine } from "./shared-set-line";

const set = (over: Partial<SharedSet> = {}): SharedSet => ({
	decided: "shared",
	instructions: "Always cite the runbook.",
	instructionsFor: ["claude-code", "codex"],
	revision: "rev-7",
	servers: [],
	...over,
});
const opened = (how: string, revision: string) => ({ kind: "session_opened", how, sharedSet: { revision, servers: [] } });

describe("sharedSetLine (#1180 §3.3)", () => {
	it("shows the compaction line on Claude Code when its session holds an older revision, with why", () => {
		expect(sharedSetLine([opened("new", "rev-6"), opened("resume", "rev-6")], "claude-code", set())).toEqual({
			line: SHARED_SET_COMPACT_LINE,
			detail: "Claude Code keeps the instructions its conversation started with until it compacts.",
		});
	});

	it("shows nothing once a compaction took up the set's revision", () => {
		expect(sharedSetLine([opened("new", "rev-6"), { kind: "compaction", phase: "completed", sharedRevision: "rev-7" }], "claude-code", set())).toBeNull();
	});

	it("shows the line when the agent stopped being a recipient of instructions its session still holds", () => {
		expect(sharedSetLine([opened("new", "rev-7")], "claude-code", set({ instructionsFor: ["codex"] }))?.line).toBe(SHARED_SET_COMPACT_LINE);
	});

	it("shows nothing for an agent that takes instructions in its first prompt, or a thread with no session yet", () => {
		expect(sharedSetLine([opened("new", "rev-6")], "codex", set())).toBeNull();
		expect(sharedSetLine([], "claude-code", set())).toBeNull();
	});
});
