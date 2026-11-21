// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	type CanonicalEvent,
	type InvestigationReport,
	recordedFindings,
	type SessionOpening,
	systemWritten,
} from "@prismalens/contracts/schemas";
import type { ReopenPath } from "../runner/acp-client.js";
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
	/** A return to the agent's own session (#1168): only events after this `seq`, the one it last saw. */
	since?: number;
	/** The full note goes into the agent's own reopened session, which no longer holds what it was sent (#1168). */
	ownSession?: boolean;
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
	const { report: stored, since } = input;
	const events =
		since === undefined
			? input.events
			: input.events.filter((e) => e.seq > since);
	// A delta carries the report only when it changed since the agent's last turn.
	const report =
		since === undefined || events.some((e) => e.kind === "report")
			? stored
			: null;
	const said = events.filter(
		(e): e is Extract<CanonicalEvent, { kind: "operator_message" }> =>
			e.kind === "operator_message",
	);
	// PrismaLens's own restart notes are not the user's words (#981).
	const messages = said.filter((m) => !m.via?.restart);
	const restarts = said.filter((m) => m.via?.restart);
	const asks = new Map<string, string>();
	const denials: string[] = [];
	for (const e of input.events) {
		if (since !== undefined && e.seq <= since && e.kind !== "permission_ask")
			continue;
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
		since === undefined && input.ownSession
			? `You are back in a thread you worked on earlier, but your session no longer holds what you were last sent. While you were away, ${input.from ?? "another agent"} carried it on; this note carries everything the thread holds. The full transcript is at ${HANDOFF_TRANSCRIPT_PATH}; read it for anything this note leaves out.`
			: since === undefined
				? `You are taking over an investigation that ${input.from ?? "another agent"} started. Its session cannot be reopened here, so this note carries what it knew. The full transcript is at ${HANDOFF_TRANSCRIPT_PATH}; read it for anything this note leaves out.`
				: `You are back in a thread you worked on earlier. While you were away, ${input.from ?? "another agent"} carried it on; this note holds only what happened since your last turn. The full transcript is at ${HANDOFF_TRANSCRIPT_PATH}.`,
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
		`## The user's messages${since === undefined ? ", oldest first, all of them" : " since your last turn, oldest first"}\n${
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
		since !== undefined && !report
			? "## The report\n(unchanged since your last turn)"
			: `## The current report\n${report ? renderReport(report) : "(no report yet)"}`,
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
		...(since === undefined ? ["the alert"] : []),
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
		transcript: renderTranscript(input.events),
		carried: carried || "nothing new",
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
			out.push(`## ${systemWritten(e) ? "PrismaLens" : "User"}\n${e.text}`);
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

/** About 8,000 tokens: the whole of a fresh session's summary (#1024). */
export const FRESH_SUMMARY_CHARS = 32_000;
const FRESH_MESSAGES = 3;
const PATH_KEYS = [
	"path",
	"file_path",
	"filePath",
	"abs_path",
	"file",
] as const;

/**
 * The record a fresh session starts from when the user chose "Start fresh with a
 * summary" (#1024): the report or last answer, findings, files touched, open asks
 * and the last few messages each way. Built from PrismaLens's record; no model call.
 */
export function buildFreshSummary(input: {
	events: readonly CanonicalEvent[];
	report: InvestigationReport | null;
	from: string | null;
	budgetChars?: number;
	/** The line before the summary; a fork names its own (#1176). */
	opening?: string;
	/** What the summary left out, when it was not cut. */
	omitted?: string;
}): Handoff {
	const { events, report } = input;
	const answers = events.filter(
		(e): e is Extract<CanonicalEvent, { kind: "agent_step" }> =>
			e.kind === "agent_step" && e.text.trim().length > 0,
	);
	const said = events.filter(
		(e): e is Extract<CanonicalEvent, { kind: "operator_message" }> =>
			e.kind === "operator_message" && !systemWritten(e) && !!e.text.trim(),
	);
	const files = new Set<string>();
	for (const e of events)
		if (e.kind === "agent_step")
			for (const c of e.toolCalls)
				for (const k of PATH_KEYS)
					if (typeof c.args[k] === "string") files.add(c.args[k] as string);
	const asked = new Map<string, string>();
	for (const e of events) {
		if (e.kind === "permission_ask")
			asked.set(e.askId, e.detail ? `${e.title} (${e.detail})` : e.title);
		else if (e.kind === "permission_answer") asked.delete(e.askId);
	}
	const recorded = recordedFindings(events);
	const findings = [
		...recorded.hypotheses.map(
			(h) => `- [suspect, ${h.status}] ${h.statement}`,
		),
		...recorded.evidence.map(
			(e) => `- [evidence] ${e.observation}${e.path ? ` (${e.path})` : ""}`,
		),
	];
	const last = answers[answers.length - 1];
	const sections = [
		report
			? `## The report\n${renderReport(report)}`
			: `## The agent's last answer\n${last ? last.text.trim() : "(none)"}`,
		...(findings.length
			? [`## Findings and suspects\n${findings.join("\n")}`]
			: []),
		...(files.size
			? [`## Files touched\n${[...files].map((f) => `- ${f}`).join("\n")}`]
			: []),
		...(asked.size
			? [
					`## Asks still open\n${[...asked.values()].map((a) => `- ${a}`).join("\n")}`,
				]
			: []),
		`## The last messages\n${[
			...said.slice(-FRESH_MESSAGES).map((m) => `User: ${m.text.trim()}`),
			...answers.slice(-FRESH_MESSAGES).map((a) => `Agent: ${a.text.trim()}`),
		].join("\n\n")}`,
	];
	const opening =
		input.opening ??
		`You are continuing a conversation ${input.from ?? "an agent"} had in this workspace. It was restarted from a summary to save context, so details below are condensed. The full transcript is at ${HANDOFF_TRANSCRIPT_PATH}.`;
	const budget = (input.budgetChars ?? FRESH_SUMMARY_CHARS) - opening.length;
	const body = sanitizeUntrustedBlock(sections.join("\n\n"));
	const cut = body.length > budget;
	return {
		text: `${opening}\n\n${fenceUntrusted(
			"PREVIOUS SESSION",
			"A summary of the previous session.",
			cut ? `${body.slice(0, Math.max(0, budget - 40))}\n(cut to fit)` : body,
		)}`,
		transcript: renderTranscript(events),
		carried: list([
			report ? "the report" : "the last answer",
			...(findings.length ? [plural(findings.length, "finding")] : []),
			...(files.size ? [plural(files.size, "file")] : []),
			...(asked.size ? [plural(asked.size, "open ask")] : []),
			"the last messages",
		]),
		omitted: cut
			? "the rest of the summary, cut to fit"
			: (input.omitted ?? "earlier detail; it stays in the transcript file"),
	};
}

/** The tail a reload's last replayed prompt must end with (#1168), whitespace collapsed. */
export function checkpointOf(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(-160);
}

/**
 * A reopened session still holds what it was last sent (#1168): its last replayed
 * user message ends with the checkpoint, and it replayed at least as many as it
 * answered. A rollback that keeps both is not detected.
 */
export function replayHolds(
	replayed: readonly string[],
	checkpoint: string | null,
	receipts: number,
): boolean {
	const last = replayed.at(-1);
	return (
		!!checkpoint &&
		last !== undefined &&
		replayed.length >= receipts &&
		checkpointOf(last).endsWith(checkpoint)
	);
}

/** What a new session was seeded with: a summary or the whole handoff, with what it carried. */
export interface SessionSeed {
	by: "summary" | "handoff";
	from: string | null;
	carried: string;
}

/** How a session opened (#1166), by `reopenPath`'s precedence; cause, agent and model are the caller's. */
export function sessionOpening(o: {
	reopen: ReopenPath | null;
	replayed: number;
	/** A fresh session that replaced a broken load. */
	fresh?: { from: string | null; carried: string } | null;
	seed?: SessionSeed | null;
	/** The model before a switch the session accepted. */
	modelFrom?: string | null;
	/** What a reopened session got of what it missed (#1168); `returnFailed` when a return opened fresh. */
	back?: {
		got: "delta" | "stale" | "unsent" | null;
		since?: number;
		from: string | null;
		carried: string;
		returnFailed?: string | null;
	} | null;
}): Omit<SessionOpening, "cause" | "harness" | "model"> {
	const switched = o.modelFrom ? { modelFrom: o.modelFrom } : {};
	if (o.reopen === "fresh")
		return o.back?.returnFailed
			? {
					how: "handoff",
					from: o.fresh?.from ?? null,
					carried: o.fresh?.carried ?? "",
					returnFailed: o.back.returnFailed.slice(0, 200),
				}
			: {
					how: "load_broken",
					from: o.fresh?.from ?? null,
					carried: o.fresh?.carried ?? "",
				};
	if (o.reopen && o.back?.got)
		return {
			how: "return",
			from: o.back.from,
			carried: o.back.carried,
			...(o.back.got === "delta"
				? o.back.since !== undefined
					? { since: o.back.since }
					: {}
				: { full: o.back.got }),
			...switched,
		};
	if (o.reopen === "resume") return { how: "resume", ...switched };
	if (o.reopen === "load-marker" || o.reopen === "load-dedupe")
		return {
			how: "load",
			replay: o.reopen === "load-marker" ? "marker" : "dedupe",
			replayed: o.replayed,
			...switched,
		};
	if (o.seed?.by === "summary") return { how: "summary" };
	if (o.seed)
		return { how: "handoff", from: o.seed.from, carried: o.seed.carried };
	return { how: "new" };
}
