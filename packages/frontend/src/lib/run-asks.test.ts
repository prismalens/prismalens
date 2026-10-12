// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	PermissionAskOutcome,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import type { RunStep } from "@/components/run/run-steps";
import { mcpTool } from "./report-view";
import { askEnd, askTitle, deriveAsks } from "./run-asks";

let seq = 0;
const base = (s: number) => ({
	runId: "00000000-0000-0000-0000-000000000001",
	branchId: "run",
	path: [],
	seq: seq++,
	label: null,
	ts: new Date(Date.UTC(2026, 9, 11, 16, 0, s)).toISOString(),
});
const ASK = "00000000-0000-0000-0000-000000000010";
const ask = (s: number, over: Record<string, unknown> = {}) =>
	({
		kind: "permission_ask",
		...base(s),
		askId: ASK,
		title: "curl -s http://localhost:9093/api/v2/alerts",
		detail: "curl -s http://localhost:9093/api/v2/alerts",
		toolKind: "execute",
		expiresAt: new Date(Date.UTC(2026, 9, 11, 16, 10, s)).toISOString(),
		...over,
	}) as CanonicalEvent;
const answer = (s: number, outcome: PermissionAskOutcome) =>
	({
		kind: "permission_answer",
		...base(s),
		askId: ASK,
		outcome,
	}) as CanonicalEvent;
const step = (n: number, callId: string, command: string): RunStep => ({
	n,
	callId,
	title: command,
	command,
	kind: "command",
	verb: "Running",
	ok: null,
	unfinished: false,
	output: null,
	at: new Date(Date.UTC(2026, 9, 11, 16, 0, 0)).toISOString(),
	took: null,
	input: null,
});

describe("deriveAsks (#820)", () => {
	it.each([
		"approved",
		"denied",
		"timed_out",
		"stopped",
		"restarted",
	] as const)("takes %s from the answer", (outcome) => {
		const [a] = deriveAsks([ask(1), answer(2, outcome)], [], { live: true });
		expect(a?.state).toBe(outcome);
	});

	it("ends an ask whose turn ended unanswered, so a follow-up never revives it", () => {
		const error = { kind: "error", ...base(3), message: "prompt timed out" } as CanonicalEvent;
		expect(deriveAsks([ask(1), error], [], { live: true })[0]?.state).toBe("ended");
	});

	it("waits while the run is live, and reads ended once it is not", () => {
		expect(deriveAsks([ask(1)], [], { live: true })[0]?.state).toBe("waiting");
		expect(deriveAsks([ask(1)], [], { live: false })[0]?.state).toBe("ended");
	});

	it("ties an ask to the step of the call it names", () => {
		const steps = [step(1, "toolu_a", "ls"), step(2, "toolu_b", "curl -s x")];
		const [a] = deriveAsks([ask(1, { toolCallId: "toolu_b" })], steps, {
			live: true,
		});
		expect(a?.step).toBe(2);
		// An ask whose call never became a step keeps no step: the transcript gives it a line.
		const [orphan] = deriveAsks([ask(1, { toolCallId: "perm-9" })], steps, {
			live: true,
		});
		expect(orphan?.step).toBeUndefined();
	});

	it("ties an older ask without a call id only to the one step running its command", () => {
		const command = "curl -s http://localhost:9093/api/v2/alerts";
		expect(
			deriveAsks([ask(5)], [step(1, "a", command)], { live: true })[0]?.step,
		).toBe(1);
		expect(
			deriveAsks([ask(5)], [step(1, "a", command), step(2, "b", command)], {
				live: true,
			})[0]?.step,
		).toBeUndefined();
	});

	it("says how an ask ended in the run's words", () => {
		expect(askEnd({ state: "timed_out", clamped: true })).toBe(
			"Denied: the run's time limit was reached",
		);
		expect(askEnd({ state: "waiting", clamped: false })).toBe(
			"Waiting for your approval",
		);
	});
});

describe("MCP tool names (#673 w5-41)", () => {
	it("reads the tool and the server a person named", () => {
		expect(
			mcpTool("mcp__plugin_context-mode_context-mode__ctx_batch_execute"),
		).toEqual({ tool: "ctx_batch_execute", server: "context-mode" });
		expect(mcpTool("mcp__github__create_issue")).toEqual({
			tool: "create_issue",
			server: "github",
		});
		expect(mcpTool("curl -s x")).toBeNull();
		expect(
			askTitle({ title: "mcp__github__create_issue", server: null }),
		).toBe("create_issue, a tool from the github MCP server");
	});
});
