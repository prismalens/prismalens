// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	agentModes,
	chosenMode,
	levelOfMode,
	modeOfLevel,
} from "./agent-modes";

const agent = (
	id: string,
	modes: { id: string; name: string }[] | null,
): HarnessStatus =>
	({
		id,
		label: id,
		checked: modes === null ? null : { modes },
	}) as unknown as HarnessStatus;

const claude = agent("claude-code", [
	{ id: "default", name: "Manual" },
	{ id: "acceptEdits", name: "Accept edits" },
	{ id: "plan", name: "Plan" },
	{ id: "bypassPermissions", name: "Bypass permissions" },
]);

describe("the agent's own modes against PrismaLens's levels (sheet §5, #1101)", () => {
	it("reads the modes the last check listed, and null when it listed none", () => {
		expect(agentModes(claude)?.map((m) => m.id)).toEqual([
			"default",
			"acceptEdits",
			"plan",
			"bypassPermissions",
		]);
		expect(agentModes(agent("claude-code", []))).toBeNull();
		expect(agentModes(agent("claude-code", null))).toBeNull();
	});

	it("maps a mode to the level whose own mode it is, before one that only falls back to it", () => {
		expect(levelOfMode(claude, "default")).toBe("supervised");
		// acceptEdits is auto-edits' mode and the fallback of auto and full-access.
		expect(levelOfMode(claude, "acceptEdits")).toBe("auto-edits");
		expect(levelOfMode(claude, "bypassPermissions")).toBe("full-access");
	});

	it("maps a mode no level runs to null, so the run sets it as is", () => {
		expect(levelOfMode(claude, "plan")).toBeNull();
	});

	it("keeps the current level when it already runs the mode, as OpenCode's levels all run build", () => {
		const opencode = agent("opencode", [
			{ id: "build", name: "Build" },
			{ id: "plan", name: "Plan" },
		]);
		expect(levelOfMode(opencode, "build", "auto")).toBe("auto");
		expect(levelOfMode(opencode, "build")).toBe("supervised");
	});

	it("gives a level's mode when offered, its fallback when only that is, and null otherwise", () => {
		expect(modeOfLevel(claude, "auto")).toBe("acceptEdits");
		expect(modeOfLevel(claude, "full-access")).toBe("bypassPermissions");
		const bare = agent("claude-code", [{ id: "default", name: "Manual" }]);
		expect(modeOfLevel(bare, "full-access")).toBeNull();
		// With no list to check against, the level's own mode stands.
		expect(modeOfLevel(agent("claude-code", null), "auto")).toBe("auto");
	});

	it("chooses the picked mode over the level's", () => {
		expect(chosenMode(claude, "supervised", "plan")).toBe("plan");
		expect(chosenMode(claude, "supervised", null)).toBe("default");
	});
});
