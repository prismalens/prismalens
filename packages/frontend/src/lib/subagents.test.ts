// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { deriveSteps } from "@/components/run/run-steps";
import { deriveTranscript, latestAgentText } from "./investigation-events";
import { deriveAsks } from "./run-asks";
import { deriveSubagents, subagentEvents } from "./subagents";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const ASK_ID = "00000000-0000-0000-0000-0000000000a1";
const T0 = Date.parse("2026-11-06T10:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let seq = 0;
const base = (s: number, path: string[] = [], label: string | null = null) => ({
	runId: RUN_ID,
	branchId: "run",
	path,
	seq: seq++,
	label,
	ts: at(s),
});

const step = (
	s: number,
	text: string,
	opts: {
		path?: string[];
		label?: string;
		calls?: { id: string; name: string; args?: Record<string, unknown> }[];
	} = {},
): CanonicalEvent => ({
	kind: "agent_step",
	...base(s, opts.path, opts.label ?? null),
	text,
	toolCalls: (opts.calls ?? []).map((c) => ({
		toolCallId: c.id,
		name: c.name,
		args: c.args ?? {},
	})),
});

const result = (
	s: number,
	id: string,
	opts: { path?: string[]; ok?: boolean } = {},
): CanonicalEvent => ({
	kind: "tool_result",
	...base(s, opts.path),
	result: {
		name: "Bash",
		toolCategory: null,
		toolCallId: id,
		source: `Bash(${id})`,
		ok: opts.ok ?? true,
		preview: "",
	},
});

const sub = (
	s: number,
	fields: Partial<Extract<CanonicalEvent, { kind: "subagent" }>> & {
		sessionId: string;
		phase: "started" | "state" | "step";
	},
	path: string[] = [],
): CanonicalEvent => ({ kind: "subagent", ...base(s, path), ...fields });

const sessionRun = (): CanonicalEvent[] => [
	step(0, "Looking at the deploys.", {
		calls: [{ id: "task-1", name: "Task", args: { description: "x" } }],
	}),
	sub(1, {
		sessionId: "s1",
		phase: "started",
		title: "Check deploys",
		task: "List deploys in the last hour",
		state: "running",
		canCancel: true,
	}),
	step(2, "I will list the deploys.", {
		path: ["s1"],
		label: "Check deploys",
		calls: [{ id: "c1", name: "Bash", args: { command: "kubectl rollout" } }],
	}),
	result(3, "c1", { path: ["s1"] }),
	sub(3, { sessionId: "s1", phase: "step", step: "Bash kubectl rollout" }),
	sub(4, { sessionId: "s2", phase: "started", title: "Nested" }, ["s1"]),
	step(5, "Nested words.", { path: ["s1", "s2"] }),
	sub(6, { sessionId: "s1", phase: "state", state: "completed" }),
	step(7, "The deploy at 09:58 is the suspect."),
];

describe("deriveSubagents", () => {
	it("keeps each sub-agent at its latest state, step and grant", () => {
		const views = deriveSubagents(sessionRun());
		expect(views.map((v) => v.sessionId)).toEqual(["s1", "s2"]);
		expect(views[0]).toMatchObject({
			title: "Check deploys",
			task: "List deploys in the last hour",
			state: "completed",
			canCancel: true,
			step: "Bash kubectl rollout",
			parent: [],
			startedAt: at(1),
		});
		expect(views[1]?.parent).toEqual(["s1"]);
		expect(views[0]?.fallback).toBeUndefined();
	});

	it("reads a sub-agent still running when its turn ended as stopped", () => {
		const views = deriveSubagents(sessionRun().slice(0, 4), { ended: true });
		expect(views[0]?.state).toBe("cancelled");
	});

	it("keeps that the text was capped", () => {
		const views = deriveSubagents([
			sub(0, { sessionId: "s1", phase: "started", title: "A" }),
			sub(1, { sessionId: "s1", phase: "state", textCapped: true }),
		]);
		expect(views[0]?.textCapped).toBe(true);
	});

	it("folds steps stamped with a parent tool call into one view of that call", () => {
		const events = [
			step(0, "", {
				calls: [
					{
						id: "toolu_1",
						name: "Task",
						args: { description: "Read logs", prompt: "Read the api logs" },
					},
				],
			}),
			step(1, "Reading.", {
				path: ["toolu_1"],
				label: "Task",
				calls: [{ id: "c1", name: "Read" }],
			}),
			result(2, "toolu_1"),
		];
		expect(deriveSubagents(events)).toEqual([
			expect.objectContaining({
				sessionId: "toolu_1",
				title: "Read logs",
				task: "Read the api logs",
				state: "completed",
				step: "Read",
				fallback: true,
				canCancel: false,
			}),
		]);
	});

	it("labels a fallback with no matching call by its label", () => {
		const views = deriveSubagents([
			step(0, "Working.", { path: ["toolu_9"], label: "general-purpose" }),
		]);
		expect(views[0]).toMatchObject({ title: "general-purpose", state: "running" });
	});
});

describe("subagentEvents", () => {
	it("returns the sub-agent's own words and steps, and its helpers'", () => {
		const own = subagentEvents(sessionRun(), "s1");
		expect(own.map((e) => e.kind)).toEqual([
			"agent_step",
			"tool_result",
			"agent_step",
		]);
	});
});

describe("the main transcript with sub-agents", () => {
	it("keeps sub-agent steps out and one node where each started", () => {
		const items = deriveTranscript(sessionRun());
		const prose = items.flatMap((i) => (i.kind === "prose" ? [i.text] : []));
		expect(prose).toEqual([
			"Looking at the deploys.",
			"The deploy at 09:58 is the suspect.",
		]);
		const nodes = items.filter((i) => i.kind === "subagent");
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			key: "subagent-s1",
			agent: { title: "Check deploys", state: "completed" },
		});
		// The agent's own delegation line gives way to the node.
		expect(items.some((i) => i.kind === "line")).toBe(false);
		expect(items.some((i) => i.kind === "tools")).toBe(false);
	});

	it("draws a fallback helper as one node where it was delegated, never as top-level text", () => {
		const events = [
			step(0, "Delegating.", {
				calls: [{ id: "toolu_1", name: "Task", args: { description: "Read logs" } }],
			}),
			step(1, "Helper prose.", { path: ["toolu_1"], label: "Task" }),
			step(2, "More helper prose.", { path: ["toolu_1"], label: "Task" }),
		];
		const items = deriveTranscript(events);
		expect(items.map((i) => i.kind)).toEqual(["prose", "subagent"]);
		expect(JSON.stringify(items)).not.toContain('"text":"Helper prose."');
	});

	it("keeps today's single line when no step names its helper", () => {
		const items = deriveTranscript([
			step(0, "", {
				calls: [{ id: "toolu_1", name: "Task", args: { description: "Read logs" } }],
			}),
		]);
		expect(items).toEqual([
			expect.objectContaining({
				kind: "line",
				text: "Delegated a sub-agent: Read logs",
			}),
		]);
	});

	it("numbers only the main agent's steps and reads only its words", () => {
		const events = [
			...sessionRun(),
			step(8, "", { calls: [{ id: "c9", name: "Bash", args: { command: "ls" } }] }),
		];
		expect(deriveSteps(events).map((s) => s.callId)).toEqual(["c9"]);
		expect(latestAgentText(events.slice(0, 7))).toBe("Looking at the deploys.");
	});

	it("names the sub-agent on its ask", () => {
		const ask: CanonicalEvent = {
			kind: "permission_ask",
			...base(1),
			askId: ASK_ID,
			title: "Bash kubectl delete",
			detail: null,
			toolKind: "execute",
			expiresAt: at(600),
			source: { kind: "subagent", sessionId: "s1", title: "Check deploys" },
		};
		expect(deriveAsks([ask], [], { live: true })[0]?.source).toEqual({
			kind: "subagent",
			sessionId: "s1",
			title: "Check deploys",
		});
	});
});
