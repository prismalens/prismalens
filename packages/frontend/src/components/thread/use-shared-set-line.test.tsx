// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SharedSet } from "@prismalens/contracts/schemas";
import { describe, expect, it, vi } from "vitest";
import { renderHookWithApp } from "@/test/render";
import { SHARED_SET_COMPACT_LINE } from "./shared-set-line";
import { useSharedSetLine } from "./use-shared-set-line";

const set: SharedSet = {
	decided: "shared",
	instructions: "Always cite the runbook.",
	instructionsFor: ["claude-code", "codex"],
	revision: "rev-7",
	servers: [],
};

const events = [
	{ kind: "session_opened", how: "resume", sharedSet: { revision: "rev-6" } },
];

describe("useSharedSetLine (#1180 §3.3)", () => {
	it("loads the line for Claude Code and shows it once its logic arrives", async () => {
		const { result } = await renderHookWithApp(
			() => useSharedSetLine(events, "claude-code"),
			{
				api: { "settings.agentSetup.sharedSet": set },
			},
		);
		await vi.waitFor(() =>
			expect(result.current?.line).toBe(SHARED_SET_COMPACT_LINE),
		);
	});

	it("reads no set and shows nothing for an agent that takes instructions in its first prompt", async () => {
		const read = vi.fn(() => set);
		const { result } = await renderHookWithApp(
			() => useSharedSetLine(events, "codex"),
			{
				api: { "settings.agentSetup.sharedSet": read },
			},
		);
		await new Promise((r) => setTimeout(r, 50));
		expect([result.current, read.mock.calls.length]).toEqual([null, 0]);
	});
});
