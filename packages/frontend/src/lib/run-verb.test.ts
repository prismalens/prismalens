// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	defaultVerb,
	followUpKind,
	recheckBrief,
	verbCopy,
	verbsFor,
} from "./run-verb";

describe("the verb chip's rules (#673 w59, DESIGN §4)", () => {
	it("offers both verbs on a draft and a reportless stopped or failed run, none elsewhere", () => {
		expect(verbsFor({ draft: true })).toEqual(["investigate", "ask"]);
		expect(verbsFor({ draft: false, continuable: true })).toEqual(["investigate", "ask"]);
		expect(verbsFor({ draft: false, live: true, continuable: true })).toEqual([]);
		expect(verbsFor({ draft: false })).toEqual([]);
	});

	it("a draft investigates while alerts fire and no report exists; a stopped run continues", () => {
		expect(defaultVerb({ draft: true }, { alertCount: 2, reported: false })).toBe("investigate");
		expect(defaultVerb({ draft: true }, { alertCount: 2, reported: true })).toBe("ask");
		expect(defaultVerb({ draft: true }, { alertCount: 0, reported: false })).toBe("ask");
		expect(defaultVerb({ draft: false, continuable: true }, { alertCount: 0, reported: true })).toBe("investigate");
	});

	it("says what Investigate does on each, and puts the verb on the wire as kind", () => {
		expect(verbCopy({ draft: true }).investigate).toMatch(/^Gathers the alert/);
		expect(verbCopy({ draft: false, continuable: true }).investigate).toBe("Continues this run to its report.");
		expect(followUpKind("investigate")).toBe("continue");
		expect(followUpKind("ask")).toBe("chat");
	});
});

describe("recheckBrief (#673 w59, OBJ-013)", () => {
	const report = {
		summary: "The pool is exhausted.",
		rootCause: "pool_size=1 in commit 138674f",
		nextSteps: [
			{ title: "Revert 138674f", detail: "", priority: "high" as const },
			{ title: "Raise pool_size", detail: "", priority: "medium" as const },
		],
	};

	it("puts what was typed first, then the report quoted", () => {
		expect(recheckBrief(report, 3, "  only the 14:02 deploy ")).toBe(
			"only the 14:02 deploy\n\nRe-check Run #3. It found: The pool is exhausted. Cause named: pool_size=1 in commit 138674f. Next steps it proposed: Revert 138674f; Raise pool_size.",
		);
	});

	it("names no cause as none, and caps the brief at 1500 characters", () => {
		expect(recheckBrief({ ...report, rootCause: null, nextSteps: [] }, 1, "")).toBe(
			"Re-check Run #1. It found: The pool is exhausted. Cause named: none. Next steps it proposed: none.",
		);
		expect(recheckBrief(report, 1, "x".repeat(2000))).toHaveLength(1500);
	});
});
