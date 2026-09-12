// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { listHarnessStatus, resolveHarnessSelection } from "./harness-selection.js";

const onPath = (present: string[]) => (bin: string) => present.includes(bin);

describe("resolveHarnessSelection", () => {
	it("refuses with install hints when nothing is on PATH", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath([]) });
		expect(s.runnable).toBe(false);
		if (!s.runnable) {
			expect(s.failure).toBe("no-harness");
			expect(s.reason).toContain("opencode");
		}
	});

	it("auto-selects the first verified harness on PATH", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini", "opencode"]) });
		expect(s).toMatchObject({ runnable: true, harness: "opencode", auto: true, verified: true });
	});

	it("never auto-selects an unverified harness, but names it in the refusal", () => {
		const s = resolveHarnessSelection({ isOnPath: onPath(["gemini"]) });
		expect(s.runnable).toBe(false);
		if (!s.runnable) expect(s.reason).toContain("PRISMALENS_HARNESS=<id>");
	});

	it("honours a pin to an unverified harness that is installed", () => {
		const s = resolveHarnessSelection({ envHarness: "gemini", isOnPath: onPath(["gemini"]) });
		expect(s).toMatchObject({ runnable: true, harness: "gemini", auto: false, verified: false });
	});

	it("refuses a pin whose binary is missing, and an unknown pin", () => {
		expect(resolveHarnessSelection({ envHarness: "codex", isOnPath: onPath([]) })).toMatchObject({
			runnable: false,
			failure: "pinned-harness-missing",
			harness: "codex",
		});
		expect(resolveHarnessSelection({ envHarness: "cursor", isOnPath: onPath([]) })).toMatchObject({
			runnable: false,
			failure: "invalid-env-harness",
		});
	});

	it("lists every registry row with installed and verified flags", () => {
		const rows = listHarnessStatus({ isOnPath: onPath(["opencode"]) });
		expect(rows.map((r) => r.id)).toEqual(["opencode", "claude-code", "codex", "gemini", "deepagents"]);
		expect(rows[0]).toMatchObject({ installed: true, verified: true });
		expect(rows[1]).toMatchObject({ installed: false });
	});
});
