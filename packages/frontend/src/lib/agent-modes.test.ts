// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { modeIcon, modeLine, NO_SANDBOX, sandboxLine, YES_CLAUSE } from "./agent-modes";

describe("modeLine", () => {
	it("adds the clause wherever the agent can ask, plan and bypass included", () => {
		for (const id of ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "read-only", "agent"])
			expect(modeLine(id, "Own words")).toBe(`Own words. ${YES_CLAUSE}`);
	});

	it("leaves it off where the agent never asks", () => {
		expect(modeLine("agent-full-access", "Unrestricted access")).toBe(
			"Unrestricted access.",
		);
		expect(modeLine("agent-default")).toBe("");
	});
});

describe("modeIcon (#673 w51)", () => {
	const enforced = { state: "enforced" as const, reason: "Codex's sandbox refused a test write outside the workspace" };
	it("locks only a mode whose check says enforced, never by its name", () => {
		expect(modeIcon("read-only", enforced)).toBe("lock");
		expect(modeIcon("agent", enforced)).toBe("lock");
		expect(modeIcon("plan")).toBe("open");
		expect(modeIcon("read-only", { state: "unknown", reason: "timed out" })).toBe("open");
		expect(modeIcon("plan", { state: "none", reason: "off" })).toBe("open");
		expect(modeIcon("acceptEdits", { state: "none", reason: "off" })).toBe("pencil");
	});

	it("says plainly when there is no sandbox, and why one is unknown", () => {
		expect(sandboxLine(enforced)).toBe(`Sandboxed: ${enforced.reason}.`);
		expect(sandboxLine({ state: "none", reason: "OpenCode has no sandbox" })).toBe(NO_SANDBOX);
		expect(NO_SANDBOX).toBe("No sandbox: the agent's mode is the only limit.");
		expect(sandboxLine({ state: "unknown", reason: "Codex's sandbox check got no answer in 5s" })).toBe(
			"Sandbox unknown: Codex's sandbox check got no answer in 5s.",
		);
		expect(sandboxLine(undefined)).toBe("Sandbox not checked yet.");
	});
});
