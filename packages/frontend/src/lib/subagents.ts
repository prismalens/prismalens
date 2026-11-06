// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, SubagentState } from "@prismalens/contracts";

/** One sub-agent the agent started (#1025), at its latest state. */
export interface SubagentView {
	sessionId: string;
	/** The lane that started it: empty for the main agent. */
	parent: string[];
	title: string;
	task: string | null;
	state: SubagentState;
	canCancel: boolean;
	/** What it does now, in one line: the tool it last called. */
	step: string | null;
	startedAt: string;
	textCapped: boolean;
	/** No session of its own: folded from steps stamped with the tool call that started it. */
	fallback?: true;
}

/** Each sub-agent state in two words at most. */
export const SUBAGENT_WORD: Record<SubagentState, string> = {
	running: "Working",
	completed: "Done",
	failed: "Failed",
	cancelled: "Stopped",
};

const DELEGATE_TOOL = /^(task|agent|delegate)/i;

/** The lane an event belongs to: empty for the main agent's own. */
export function laneOf(e: CanonicalEvent): readonly string[] {
	return "path" in e ? e.path : [];
}

/** A step a sub-agent made, never the main agent's own (#1025). */
export function isSubagentStep(e: CanonicalEvent): boolean {
	return (
		(e.kind === "agent_step" || e.kind === "tool_result") &&
		laneOf(e).length > 0
	);
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
	const v = args[key];
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Every sub-agent in the order it started. An agent that sends no sessions
 * stamps steps with the tool call that started the helper; those fold into one
 * view keyed by that call, its state read from the call's own result.
 */
export function deriveSubagents(
	events: readonly CanonicalEvent[],
	opts: { ended?: boolean } = {},
): SubagentView[] {
	const views = new Map<string, SubagentView>();
	const calls = new Map<
		string,
		{ name: string; args: Record<string, unknown>; at: string }
	>();
	const results = new Map<string, boolean>();
	for (const e of events) {
		if (e.kind === "subagent") {
			const known = views.get(e.sessionId);
			const view: SubagentView = known ?? {
				sessionId: e.sessionId,
				parent: [...e.path],
				title: e.title ?? "Sub-agent",
				task: null,
				state: "running",
				canCancel: false,
				step: null,
				startedAt: e.ts,
				textCapped: false,
			};
			if (known?.fallback) delete view.fallback;
			if (e.title) view.title = e.title;
			if (e.task) view.task = e.task;
			if (e.state) view.state = e.state;
			if (e.canCancel !== undefined) view.canCancel = e.canCancel;
			if (e.step) view.step = e.step;
			if (e.textCapped) view.textCapped = true;
			views.set(e.sessionId, view);
		} else if (e.kind === "agent_step" && laneOf(e).length === 0) {
			for (const c of e.toolCalls)
				if (DELEGATE_TOOL.test(c.name))
					calls.set(c.toolCallId, { name: c.name, args: c.args, at: e.ts });
		} else if (e.kind === "tool_result" && laneOf(e).length === 0) {
			results.set(e.result.toolCallId, e.result.ok);
		}
	}
	for (const e of events) {
		if (e.kind !== "agent_step" && e.kind !== "tool_result") continue;
		if (laneOf(e).length === 0) continue;
		const head = laneOf(e)[0] as string;
		if (views.has(head) && !views.get(head)?.fallback) continue;
		const call = calls.get(head);
		const view: SubagentView = views.get(head) ?? {
			sessionId: head,
			parent: [],
			title:
				(call &&
					(stringArg(call.args, "description") ??
						stringArg(call.args, "name"))) ??
				e.label ??
				call?.name ??
				"Sub-agent",
			task: call ? stringArg(call.args, "prompt") : null,
			state: "running",
			canCancel: false,
			step: null,
			startedAt: call?.at ?? e.ts,
			textCapped: false,
			fallback: true,
		};
		if (e.kind === "agent_step") {
			const last = e.toolCalls[e.toolCalls.length - 1];
			if (last) view.step = last.name;
		}
		views.set(head, view);
	}
	for (const view of Array.from(views.values())) {
		const ok = results.get(view.sessionId);
		if (view.fallback && ok !== undefined)
			view.state = ok ? "completed" : "failed";
		// A turn that ended took its sub-agents with it.
		if (opts.ended && view.state === "running") view.state = "cancelled";
	}
	return Array.from(views.values()).sort((a, b) =>
		a.startedAt.localeCompare(b.startedAt),
	);
}

/** One sub-agent's own words and tool steps, and those of the helpers it started. */
export function subagentEvents(
	events: readonly CanonicalEvent[],
	sessionId: string,
): CanonicalEvent[] {
	return events.filter(
		(e) =>
			(e.kind === "agent_step" || e.kind === "tool_result") &&
			laneOf(e).includes(sessionId),
	);
}
