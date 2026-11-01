// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts/schemas";
import { fenceUntrusted, sanitizeUntrustedBlock } from "./fence.js";

/** About 16k tokens: the budgeted part of a handoff, after what is always carried. */
export const HANDOFF_BUDGET_CHARS = 64_000;
const RESULT_CHARS = 1_500;

export const RESTART_NOTE =
	"PrismaLens restarted while the previous session was working: its last command may or may not have completed. Check before relying on its effect.";

/** Where a handoff's full transcript is written, under the agent's working directory. */
export const HANDOFF_TRANSCRIPT_PATH = ".prismalens-handoff/transcript.md";

export interface HandoffInput {
	events: readonly CanonicalEvent[];
	report: InvestigationReport | null;
	accessLevel: AccessLevel;
	/** The agent the run was in, for the opening line. */
	from: string | null;
	afterRestart?: boolean;
	budgetChars?: number;
}

export interface Handoff {
	/** The seed for the new session's first prompt. */
	text: string;
	/** The whole conversation, for the transcript file. */
	transcript: string;
	/** e.g. "the alert, 2 messages, the report and 9 cited calls". */
	carried: string;
	/** e.g. "the other 23 tool calls"; they stay in the transcript file. Null when nothing is left out. */
	omitted: string | null;
}

interface Call {
	id: string;
	name: string;
	args: Record<string, unknown>;
	result?: {
		ok: boolean;
		source: string;
		preview: string;
		error?: string | null;
	};
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`;

/** "a, b and c": the parts read as one phrase in the composer hint and the transcript. */
const list = (parts: string[]) =>
	parts.length < 2
		? (parts[0] ?? "")
		: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

function citedIds(report: InvestigationReport | null): Set<string> {
	const ids = new Set<string>();
	for (const e of [
		...(report?.hypotheses ?? []).flatMap((h) => h.evidence ?? []),
		...(report?.ruledOut ?? []).flatMap((r) => r.evidence ?? []),
	])
		if (e.toolCallId) ids.add(e.toolCallId);
	return ids;
}

function callsOf(events: readonly CanonicalEvent[]): Call[] {
	const calls = new Map<string, Call>();
	for (const e of events) {
		if (e.kind === "agent_step")
			for (const c of e.toolCalls)
				calls.set(c.toolCallId, {
					id: c.toolCallId,
					name: c.name,
					args: c.args,
				});
		else if (e.kind === "tool_result") {
			const call = calls.get(e.result.toolCallId) ?? {
				id: e.result.toolCallId,
				name: e.result.name,
				args: {},
			};
			call.result = e.result;
			calls.set(call.id, call);
		}
	}
	return [...calls.values()];
}

function renderCall(c: Call): string {
	const head = `- ${c.name} ${c.result?.source ?? JSON.stringify(c.args)}`;
	if (!c.result) return `${head}\n  (no result recorded)`;
	const body = c.result.ok
		? c.result.preview
		: `FAILED: ${c.result.error ?? c.result.preview}`;
	return `${head}\n  ${body.slice(0, RESULT_CHARS).replace(/\n/g, "\n  ")}`;
}

function renderReport(r: InvestigationReport): string {
	const lines = [`Summary: ${r.summary}`];
	if (r.rootCause) lines.push(`Root cause: ${r.rootCause}`);
	lines.push("Hypotheses, most plausible first, with their status:");
	for (const h of r.hypotheses ?? [])
		lines.push(`- [${h.status}] ${h.statement}`);
	for (const o of r.ruledOut ?? [])
		lines.push(`- [ruled out] ${o.statement}: ${o.why}`);
	return lines.join("\n");
}

/**
 * The context a fresh session needs to carry on a run another session started.
 * The request, every user message, the report with every hypothesis status and
 * the permission with its denials are never trimmed; tool calls fill a budget newest first.
 */
export function buildHandoff(input: HandoffInput): Handoff {
	const { events, report } = input;
	const said = events.filter(
		(e): e is Extract<CanonicalEvent, { kind: "operator_message" }> =>
			e.kind === "operator_message",
	);
	// PrismaLens's own restart notes are not the user's words (#981).
	const messages = said.filter((m) => !m.via?.restart);
	const restarts = said.filter((m) => m.via?.restart);
	const asks = new Map<string, string>();
	const denials: string[] = [];
	for (const e of events) {
		if (e.kind === "permission_ask")
			asks.set(e.askId, e.detail ? `${e.title} (${e.detail})` : e.title);
		else if (e.kind === "permission_answer" && e.outcome === "denied")
			denials.push(asks.get(e.askId) ?? e.title ?? "a tool call");
	}
	const cited = citedIds(report);
	const calls = callsOf(events).reverse();
	const citedCalls = calls.filter((c) => cited.has(c.id));
	const failedCalls = calls.filter(
		(c) => !cited.has(c.id) && c.result && !c.result.ok,
	);
	const turns = events
		.filter(
			(e): e is Extract<CanonicalEvent, { kind: "agent_step" }> =>
				e.kind === "agent_step" && e.text.trim().length > 0,
		)
		.reverse();

	const kept: string[] = [
		`You are taking over an investigation that ${input.from ?? "another agent"} started. Its session cannot be reopened here, so this note carries what it knew. The full transcript is at ${HANDOFF_TRANSCRIPT_PATH}; read it for anything this note leaves out.`,
	];
	if (input.afterRestart) kept.push(RESTART_NOTE);
	kept.push(
		`## Permission\nThe run's level is ${input.accessLevel}. It is inherited: do not ask for more.${
			denials.length
				? `\nThe user denied:\n${denials.map((d) => `- ${d}`).join("\n")}`
				: ""
		}`,
	);
	kept.push(
		`## The user's messages, oldest first, all of them\n${
			messages.length
				? messages
						.map(
							(m, i) =>
								`${i + 1}. ${m.text}${m.delivered ? "" : " (never reached the agent)"}`,
						)
						.join("\n")
				: "(none)"
		}`,
	);
	if (restarts.length)
		kept.push(
			`## PrismaLens's messages after it restarted\n${restarts.map((m) => `- ${m.text}`).join("\n")}`,
		);
	kept.push(
		`## The current report\n${report ? renderReport(report) : "(no report yet)"}`,
	);

	let room = input.budgetChars ?? HANDOFF_BUDGET_CHARS;
	const fit = <T>(items: T[], render: (t: T) => string) => {
		const out: string[] = [];
		for (const item of items) {
			const line = render(item);
			if (line.length > room) break;
			room -= line.length;
			out.push(line);
		}
		return out;
	};
	const citedOut = fit(citedCalls, renderCall);
	const failedOut = fit(failedCalls, renderCall);
	const turnsOut = fit(
		turns,
		(t) => `- ${t.text.trim().slice(0, RESULT_CHARS)}`,
	);
	const budgeted: string[] = [];
	if (citedOut.length)
		budgeted.push(
			`## Tool calls the report cites, newest first\n${citedOut.join("\n")}`,
		);
	if (failedOut.length)
		budgeted.push(
			`## Tool calls that failed, newest first\n${failedOut.join("\n")}`,
		);
	if (turnsOut.length)
		budgeted.push(
			`## What the agent said, newest first\n${turnsOut.join("\n")}`,
		);

	const refuted = (report?.hypotheses ?? []).filter(
		(h) => h.status === "refuted",
	).length;
	const carried = list([
		"the alert",
		...(messages.length ? [plural(messages.length, "message")] : []),
		...(report ? ["the report"] : []),
		...(refuted
			? [plural(refuted, "refuted hypothesis", "refuted hypotheses")]
			: []),
		...(denials.length ? [plural(denials.length, "denial")] : []),
		...(citedOut.length ? [plural(citedOut.length, "cited call")] : []),
		...(failedOut.length ? [plural(failedOut.length, "failed call")] : []),
	]);
	const leftCalls = calls.length - citedOut.length - failedOut.length;
	const leftTurns = turns.length - turnsOut.length;
	const omittedParts = [
		...(leftCalls > 0
			? [
					`${citedOut.length + failedOut.length ? "the other " : ""}${plural(leftCalls, "tool call")}`,
				]
			: []),
		...(leftTurns > 0 ? [plural(leftTurns, "agent turn")] : []),
	];

	return {
		text: [
			...kept,
			...(budgeted.length
				? [
						fenceUntrusted(
							"PREVIOUS SESSION",
							"What the previous session ran and said.",
							sanitizeUntrustedBlock(budgeted.join("\n\n")),
						),
					]
				: []),
		].join("\n\n"),
		transcript: renderTranscript(events),
		carried,
		omitted: omittedParts.length ? list(omittedParts) : null,
	};
}

/** Every user message, agent turn and tool call in order, for the workspace file. */
export function renderTranscript(events: readonly CanonicalEvent[]): string {
	const calls = new Map(callsOf(events).map((c) => [c.id, c]));
	const out: string[] = ["# Previous session transcript"];
	const shown = new Set<string>();
	for (const e of events) {
		if (e.kind === "operator_message")
			out.push(`## ${e.via?.restart ? "PrismaLens" : "User"}\n${e.text}`);
		else if (e.kind === "agent_step") {
			if (e.text.trim()) out.push(`## Agent\n${e.text}`);
			for (const c of e.toolCalls) {
				// An adapter re-announces a call once its command is known; write it once.
				if (shown.has(c.toolCallId)) continue;
				shown.add(c.toolCallId);
				const call = calls.get(c.toolCallId);
				if (call) out.push(renderCall(call));
			}
		} else if (e.kind === "error") out.push(`## Error\n${e.message}`);
	}
	return `${fenceUntrusted(
		"PREVIOUS SESSION TRANSCRIPT",
		"What the previous session ran and said, in order.",
		sanitizeUntrustedBlock(out.join("\n\n")),
	)}\n`;
}
