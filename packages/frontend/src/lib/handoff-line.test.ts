// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { endReasonStatus, handoffLine } from "./handoff-line";

const preview = {
	route: "handoff" as const,
	harness: "codex" as const,
	carried: "alert, 3 messages, report, 2 refuted hypotheses, 9 cited calls",
	omitted: "31 tool calls (in the transcript file)",
	accessLevel: "auto" as const,
	preflight: null,
	note: null,
};

describe("handoffLine", () => {
	it("says what a handoff carries and omits, and the inherited level", () => {
		expect(handoffLine(preview, "Codex").text).toBe(
			"Continues in a fresh Codex session. Carries: alert, 3 messages, report, 2 refuted hypotheses, 9 cited calls; omits 31 tool calls (in the transcript file). Permission: Auto (inherited).",
		);
	});

	it("names a saved session as the route when the agent can load it", () => {
		expect(
			handoffLine({ ...preview, route: "load", note: "The last command may not have run." }, "OpenCode").text,
		).toBe("Continues in OpenCode's own session. The last command may not have run.");
	});

	it("turns a preflight failure into the problem and its fix", () => {
		expect(
			handoffLine(
				{ ...preview, preflight: { problem: "Codex is not signed in.", fix: "Sign in: `codex login`." } },
				"Codex",
			).problem,
		).toBe("Codex is not signed in. Sign in: `codex login`.");
	});
});

describe("endReasonStatus", () => {
	it("reads interrupted and limited in place of Failed", () => {
		expect(endReasonStatus("interrupted", "Codex")?.text).toBe(
			"Interrupted (PrismaLens restarted)",
		);
		expect(endReasonStatus("limited", "Claude Code")?.sub).toContain(
			"Claude Code reached its usage limit. Continue below in another agent",
		);
		expect(endReasonStatus(null, "Codex")).toBeNull();
	});
});
