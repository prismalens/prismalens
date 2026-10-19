// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * CanonicalEvent → view-model (architecture-review #5).
 *
 * A PURE transform from a canonical investigation event to a renderable row. Kept
 * presentation-agnostic (returns data, not JSX) so the terminal CLI renderer and a
 * future desktop view can share it — for now the web panel is the only consumer.
 * TODO(#5): lift this into a shared package once the CLI's `liveTimelineEntry`
 * adopts it, so all three runtimes render the canonical stream identically.
 */
import type { AccessLevel } from "@prismalens/config/harness";
import type {
	CanonicalEvent,
	RunCredential,
	StreamToolResult,
} from "@prismalens/contracts";
import {
	ACCESS_LEVEL_LABEL,
	ModelReportSchema,
} from "@prismalens/contracts/schemas";
import { formatClock, formatElapsed } from "./format-time";
import { endHint, isStopMessage, messageEndLine } from "./run-end-line";

export type EventIcon =
	| "activity"
	| "brain"
	| "tool"
	| "lightbulb"
	| "warning"
	| "check";

export interface EventRow {
	key: string;
	icon: EventIcon;
	message: string;
	/** Optional secondary line (thinking text, result preview). */
	detail?: string;
	ok?: boolean;
	/** The tool call a row belongs to, so a call and its result read as one. */
	callId?: string;
}

export const REPORT_DRAFTED = "Report drafted";
export const REPORT_CUT = "Report draft cut off";

/**
 * Is this block the report itself? The schema decides — not a guess at two of
 * its field names.
 *
 * The previous version accepted any object with a string `summary` and an array
 * `hypotheses`. Both names are schema-REQUIRED, so that check never rejected a
 * real report — it was strictly looser than the contract, and its whole failure
 * mode was over-hiding: an agent printing
 * `{"summary":"what I'll do next","hypotheses":["a","b"]}` had that text
 * silently replaced by "Report drafted" and lost. `safeParse` makes the answer
 * exactly "what the contract calls a report", so there is no third opinion
 * about the report's shape left to drift out of sync with the other two.
 *
 * `ModelReportSchema`, the one the engine accepts a report by: a stricter
 * schema printed a report the engine took as raw JSON (#673 w7-5). It strips
 * the host-stamped `fidelity`, so a stamped report passes too.
 *
 * Only a COMPLETE object is recognised; see {@link agentStepMessage} for a
 * block cut off mid-way.
 */
function isReportJson(body: string): boolean {
	const trimmed = body.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	try {
		return ModelReportSchema.safeParse(JSON.parse(trimmed)).success;
	} catch {
		return false;
	}
}

/**
 * The agent's last text is the report itself, as JSON: bare, fenced, or after
 * a line of prose (#659). The panel names that step instead of printing the
 * document; a draft that fails the schema is cut from the text (see
 * {@link splitAgentText}). A fence closes only on its own
 * line, so a backtick run inside a JSON string does not end the block early.
 *
 * A message sent mid-turn flushes the text so far, so a report can arrive cut
 * off: an unclosed ```json block opening with `"summary"` reads as a line (#673 walk 4).
 */
export function agentStepMessage(text: string): string {
	return splitAgentText(text).text;
}

const REPORT_KEYS = new Set(Object.keys(ModelReportSchema.shape));

/** JSON carrying two or more of the report's own fields: a draft, whether it validates or not (#673 w8-14). */
function isReportShaped(body: string): boolean {
	const trimmed = body.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	let keys: string[];
	try {
		const value: unknown = JSON.parse(trimmed);
		keys = value && typeof value === "object" ? Object.keys(value) : [];
	} catch {
		keys = Array.from(trimmed.matchAll(/"(\w+)"\s*:/g), (m) => m[1] ?? "");
	}
	return new Set(keys.filter((k) => REPORT_KEYS.has(k))).size >= 2;
}

/**
 * The agent's text with every report-shaped JSON block taken out. The engine
 * retries a draft that fails the schema; the draft folds instead of printing.
 */
export function splitAgentText(text: string): {
	text: string;
	draft?: string;
} {
	const whole = wholeReport(text);
	if (whole) return { text: whole };
	const drafts: string[] = [];
	let rest = "";
	let from = 0;
	for (const open of Array.from(text.matchAll(/```(?:json)?[ \t]*\r?\n/gi))) {
		const at = open.index ?? 0;
		if (at < from) continue;
		const start = at + open[0].length;
		for (const close of Array.from(
			text.slice(start).matchAll(/^```[ \t]*$/gm),
		)) {
			const end = start + (close.index ?? 0);
			if (!isReportShaped(text.slice(start, end))) continue;
			drafts.push(text.slice(start, end).trim());
			rest += text.slice(from, at);
			from = end + close[0].length;
			break;
		}
	}
	rest += text.slice(from);
	if (drafts.length === 0)
		for (const line of Array.from(rest.matchAll(/^[ \t]*\{/gm))) {
			if (!isReportShaped(rest.slice(line.index))) continue;
			drafts.push(rest.slice(line.index).trim());
			rest = rest.slice(0, line.index);
			break;
		}
	if (drafts.length === 0) return { text };
	return { text: rest.trim(), draft: drafts.join("\n\n") };
}

/** The whole step as one line: a report the engine takes, or one cut off mid-block. */
function wholeReport(text: string): string | null {
	for (const open of Array.from(text.matchAll(/```(?:json)?[ \t]*\r?\n/gi))) {
		const start = (open.index ?? 0) + open[0].length;
		for (const close of Array.from(
			text.slice(start).matchAll(/^```[ \t]*$/gm),
		)) {
			if (isReportJson(text.slice(start, start + (close.index ?? 0)))) {
				return REPORT_DRAFTED;
			}
		}
	}
	for (const line of Array.from(text.matchAll(/^[ \t]*\{/gm))) {
		if (isReportJson(text.slice(line.index))) return REPORT_DRAFTED;
	}
	// Every opener is checked: an earlier closed block must not hide a later cut one (#805).
	for (const open of Array.from(text.matchAll(/```(?:json)?[ \t]*\r?\n/gi))) {
		const rest = text.slice((open.index ?? 0) + open[0].length);
		if (/^\s*\{\s*"summary"\s*:/.test(rest) && !/^```[ \t]*$/m.test(rest))
			return REPORT_CUT;
	}
	return null;
}

/** Map one canonical event to a row, or null when it shouldn't be shown. */
export function canonicalEventToRow(event: CanonicalEvent): EventRow | null {
	switch (event.kind) {
		case "agent_step": {
			const key = `${event.branchId}-${event.seq}`;
			const text = agentStepMessage(event.text.trim());
			if (event.toolCalls.length > 0) {
				const names = event.toolCalls.map((t) => t.name).join(", ");
				return {
					key,
					icon: "tool",
					message: `Running ${names}`,
					detail: text || undefined,
				};
			}
			return text ? { key, icon: "brain", message: text } : null;
		}
		case "tool_result": {
			const key = `${event.branchId}-${event.seq}`;
			return {
				key,
				icon: event.result.ok ? "check" : "warning",
				message: event.result.source,
				detail: event.result.preview?.slice(0, 240) || undefined,
				ok: event.result.ok,
				callId: event.result.toolCallId,
			};
		}
		case "branch_done":
			return {
				key: `${event.branchId}-${event.seq}`,
				icon: "activity",
				message: `Investigation ${event.reason}`,
			};
		case "error":
			return {
				key: `${event.branchId}-${event.seq}`,
				icon: "warning",
				message: `Error: ${event.message}`,
			};
		case "report":
			return {
				key: `report-${event.seq}`,
				icon: "check",
				message: "Report ready",
			};
		case "operator_message":
			return {
				key: `${event.branchId}-${event.seq}`,
				icon: "activity",
				message: event.delivered
					? "Your message"
					: "Your message, not delivered",
				detail: event.text,
			};
		case "session_config":
			return {
				key: `${event.branchId}-${event.seq}`,
				icon: event.accepted ? "check" : "warning",
				message: sessionConfigLine(event),
			};
		default:
			return null;
	}
}

export interface BranchGroup {
	branchId: string;
	/**
	 * Best-effort human label for the branch, for the branch-aware stream header
	 * (ADR-0007 differentiator / ADR-0016 fan-out seam). Derived from the first
	 * `agent_step` that carries a `label` (its spawning subagent name); the
	 * canonical `report` event carries no `branchId` (ADR-0016 §2 — reduce is one
	 * whole-run join, not per-branch), so there is no report-side signal to fall
	 * back to yet. Null degrades the header to the id alone.
	 */
	focus: string | null;
	rows: EventRow[];
}

export interface GroupedEventRows {
	/** Per-branch rows, in first-seen branch order. */
	branches: BranchGroup[];
	/** The reduce-step `report` row(s) — branch-less, rendered once for the whole run. */
	reportRows: EventRow[];
}

/**
 * Group canonical events by `branchId` for the branch-aware investigation stream
 * (ADR-0007 / ADR-0016 — the fan-out seam is latent today: N=1, single "root"
 * branch). PURE, same contract as {@link canonicalEventToRow}.
 *
 * Upserts by each row's `(branchId, seq)` key (see `EventRow.key`) so a replayed
 * or duplicated event overwrites its prior row in place rather than appending a
 * second copy — grouping stays idempotent under replay.
 */
export function groupEventsByBranch(
	events: CanonicalEvent[],
): GroupedEventRows {
	const branchOrder: string[] = [];
	const branchRows = new Map<string, Map<string, EventRow>>();
	const branchFocus = new Map<string, string>();
	const reportRows = new Map<string, EventRow>();

	for (const event of events) {
		const row = canonicalEventToRow(event);
		if (!row) continue;

		if (event.kind === "report") {
			reportRows.set(row.key, row);
			continue;
		}

		let rows = branchRows.get(event.branchId);
		if (!rows) {
			rows = new Map();
			branchRows.set(event.branchId, rows);
			branchOrder.push(event.branchId);
		}
		rows.set(row.key, row);

		if (
			!branchFocus.has(event.branchId) &&
			event.kind === "agent_step" &&
			event.label
		) {
			branchFocus.set(event.branchId, event.label);
		}
	}

	return {
		branches: branchOrder.map((branchId) => ({
			branchId,
			focus: branchFocus.get(branchId) ?? null,
			rows: Array.from(branchRows.get(branchId)?.values() ?? []),
		})),
		reportRows: Array.from(reportRows.values()),
	};
}

export interface StreamView extends GroupedEventRows {
	/** True only when the run really fanned out. */
	isMultiBranch: boolean;
	/** Single-branch rendering: one flat list, report row last. Empty otherwise. */
	flatRows: EventRow[];
}

/**
 * The stream panel's whole render decision, PURE and testable apart from React.
 *
 * A branch id is not a fan-out signal: a live fan-out shows `[b0]` before `b1`
 * arrives, and a cancelled run's terminal event is stamped `supervisor`
 * (`engine/src/supervisor/investigate.ts`). Only the branch COUNT is (#280).
 */
export function deriveStreamView(events: CanonicalEvent[]): StreamView {
	const grouped = groupEventsByBranch(events);
	const isMultiBranch = grouped.branches.length > 1;

	return {
		...grouped,
		isMultiBranch,
		flatRows: isMultiBranch
			? []
			: [...(grouped.branches[0]?.rows ?? []), ...grouped.reportRows],
	};
}

// =============================================================================
// Transcript (#743): the conversation read like chat
// =============================================================================

/** Gap before an agent step that earns a `Thought for Ns` line. */
export const THOUGHT_GAP_S = 20;
/** Past this, the last step is stale: the strip and the thinking line rot. */
export const STALE_AFTER_S = 90;

export type OperatorState =
	| "started"
	| "resumed"
	| "asked"
	| "queued"
	| "sent_now"
	| "delivered"
	| "answered"
	| "not_delivered";

/** The ruling's words for an operator message's delivery (#743 §3c). */
export const OPERATOR_STATE_LABEL: Record<OperatorState, string> = {
	started: "Started the run",
	resumed: "Continued the run",
	asked: "Asked",
	queued: "Queued",
	sent_now: "Sent now",
	delivered: "Delivered",
	answered: "Answered",
	not_delivered: "Not delivered",
};

/** What the harness answered when the run set its model or effort (R4.2). */
export function sessionConfigLine(e: {
	option: "model" | "effort" | "tools";
	value: string;
	accepted: boolean;
}): string {
	if (e.option === "tools")
		return e.accepted
			? "The agent took PrismaLens tools before the first prompt"
			: "The agent does not take PrismaLens tools";
	const what = e.option === "model" ? `model ${e.value}` : `${e.value} effort`;
	return e.accepted
		? `The agent took ${what} before the first prompt`
		: `The agent would not take ${what}`;
}

/** What the conversation shows of a file that went with a message (R4.3). */
export interface AttachmentView {
	id: string;
	name: string;
	mimeType: string;
	size: number;
}

/** A message the API accepted that has not come back as an event yet. */
export interface PendingMessage {
	id: string;
	/** The id the API gave a queued message; its events carry it (#820). */
	messageId?: string;
	text: string;
	mode: "queue" | "now";
	at: string;
	undelivered?: boolean;
	attachments?: AttachmentView[];
}

export interface TranscriptRun {
	status: string;
	live: boolean;
	/** A thread's kind and what it can do next decide its end line (#673 w59). */
	kind?: string | null;
	hasReport?: boolean;
	continuable?: boolean;
	/** How the last follow-up ended; read when its own events were dropped (#804 OBJ-028). */
	lastTurnOutcome?: string | null;
	stopRequested?: boolean;
	error?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	id?: string;
	/** The level the run's asks were answered at (#673 w21). */
	accessLevel?: AccessLevel | null;
}

export type { AskState } from "./run-asks";

export type TranscriptItem =
	| {
			kind: "prose";
			key: string;
			text: string;
			at?: string;
			/** Report JSON the agent wrote here, folded under the text (#673 w8-14). */
			draft?: string;
	  }
	/** Where an ask was; it shows only when no step of the run carries it (#820). */
	| { kind: "ask"; key: string; askId: string }
	| { kind: "line"; key: string; text: string }
	/** An ask the run's level answered: allowed, or a mode switch refused (#673 w21). */
	| {
			kind: "level";
			key: string;
			outcome: "allowed" | "mode_kept" | "unattended";
			text: string;
	  }
	| {
			kind: "tools";
			key: string;
			count: number;
			summary: string;
			failed: number;
			running: number;
			/** The turn ended with calls unanswered: they read "not finished", never "running". */
			unfinished?: boolean;
			rows: EventRow[];
			/** The tool calls in the group, so a report's evidence link can open it. */
			callIds: string[];
	  }
	| { kind: "thought"; key: string; seconds: number }
	| { kind: "divider"; key: string; text: string }
	| { kind: "thinking"; key: string; seconds: number; stale: boolean }
	| {
			kind: "operator";
			key: string;
			text: string;
			at: string;
			state: OperatorState;
			mode: "queue" | "now";
			attachments: AttachmentView[];
	  }
	| {
			kind: "end";
			key: string;
			tone: "done" | "failed" | "stale";
			text: string;
			/** A failed run's raw error, for the one failure sentence (failure-sentence.ts). */
			error?: string | null;
			at?: string | null;
			detail?: string;
			report?: boolean;
			path?: string;
			/** What the box can do next, under the line (run-end-line.ts). */
			hint?: string | null;
			/** A finished report offers `Investigate again` (#673 w59). */
			recheck?: boolean;
	  }
	| { kind: "empty"; key: string; text: string };

const DELEGATE_TOOL = /^(task|agent|delegate)/i;

function seconds(from: string, to: number): number {
	return Math.max(0, Math.round((to - new Date(from).getTime()) / 1000));
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

interface OpenGroup {
	item: Extract<TranscriptItem, { kind: "tools" }>;
	calls: Map<string, StreamToolResult | null>;
}

export type FileVerb = "read" | "write" | "edit" | "delete" | "move";

const FILE_VERBS: [RegExp, FileVerb][] = [
	[/^(write|create)(?![a-z])/i, "write"],
	[/^(edit|multiedit|str_replace|replace|patch)(?![a-z])/i, "edit"],
	[/^(delete|remove|rm)\b/i, "delete"],
	[/^(move|rename|mv)\b/i, "move"],
];

/** What a file tool did, from its name ("Write /tmp/x", "edit"); a read unless it says otherwise (#673). */
export function fileVerb(name: string): FileVerb {
	const word = name.trim().replace(/^`/, "");
	return FILE_VERBS.find(([test]) => test.test(word))?.[1] ?? "read";
}

const FILE_PAST: Record<FileVerb, string> = {
	read: "read",
	write: "wrote",
	edit: "edited",
	delete: "deleted",
	move: "moved",
};

/** `read 2 files, searched 1 pattern`: what a tool group did, by category. */
export function summarizeTools(
	results: (StreamToolResult | null)[],
	opts: { ended?: boolean } = {},
): string {
	const files = new Map<FileVerb, number>();
	let search = 0;
	let source = 0;
	let other = 0;
	let running = 0;
	for (const r of results) {
		if (!r) running++;
		else if (r.toolCategory === "file") {
			const verb = fileVerb(r.name);
			files.set(verb, (files.get(verb) ?? 0) + 1);
		} else if (r.toolCategory === "search") search++;
		else if (r.toolCategory) source++;
		else other++;
	}
	const parts: string[] = [];
	for (const verb of Object.keys(FILE_PAST) as FileVerb[]) {
		const n = files.get(verb);
		if (n) parts.push(`${FILE_PAST[verb]} ${plural(n, "file", "files")}`);
	}
	if (search) parts.push(`searched ${plural(search, "pattern", "patterns")}`);
	if (source) parts.push(`queried ${plural(source, "source", "sources")}`);
	if (other) parts.push(`ran ${plural(other, "command", "commands")}`);
	if (running)
		parts.push(`${running} ${opts.ended ? "not finished" : "running"}`);
	return parts.join(", ");
}

function delegateTitle(call: { name: string; args: Record<string, unknown> }) {
	const d = call.args.description;
	return typeof d === "string" && d.trim() ? d.trim() : call.name;
}

/** `api@1a2b3c4, worker@5d6e7f8`, or the lone short sha for one repo (#747). */
export function pinnedTo(
	workspace: { repos: { name: string; head: string }[] } | null | undefined,
): string | undefined {
	const repos = workspace?.repos ?? [];
	if (repos.length === 0) return undefined;
	if (repos.length === 1) return repos[0]?.head.slice(0, 7);
	return repos.map((r) => `${r.name}@${r.head.slice(0, 7)}`).join(", ");
}

/** `token A`, `machine git (gh, sumit)`, `public`; a fallback says the machine's own git was refused (#673). */
export function credentialLabel(c: RunCredential): string {
	return c.fallback ? `${c.label} (your machine's git was refused)` : c.label;
}

/**
 * The `Code:` clause of a run (UI placement, #673): which credential cloned each
 * repository, with the full source and fingerprint for the tooltip. Null on a run
 * from before credentials were recorded, or one that read no code.
 */
export function runCodeClause(
	workspace:
		| { repos: { name: string; credential?: RunCredential }[] }
		| null
		| undefined,
): { text: string; title: string } | null {
	const repos = (workspace?.repos ?? []).flatMap((r) =>
		r.credential ? [{ name: r.name, credential: r.credential }] : [],
	);
	if (repos.length === 0) return null;
	const labels = repos
		.map((r) => credentialLabel(r.credential))
		.filter((label, i, all) => all.indexOf(label) === i);
	const title = repos
		.map((r) => {
			const detail = `${credentialLabel(r.credential)}, via ${r.credential.via}`;
			return repos.length > 1 ? `${r.name}: ${detail}` : detail;
		})
		.join("\n");
	return { text: `Code: ${labels.join(", ")}`, title };
}

/** The line before a follow-up's first message: the same session, and the code it reopened at. */
export function resumedLine(resumed: { name: string; head: string }[]): string {
	const at = pinnedTo({ repos: resumed });
	return at
		? `Resumed in the same session, code at ${at}`
		: "Resumed in the same session";
}

/** A follow-up's first message: an Ask, or the run continued to its report (#673 walk 4). */
function followUpState(
	followUp: "chat" | "continue" | undefined,
	kind: string | null | undefined,
): OperatorState {
	if (followUp === "chat" || (!followUp && kind === "chat")) return "asked";
	return "resumed";
}

function transcriptPath(runId?: string): string {
	return `runs/${runId ?? "<id>"}/transcript.jsonl`;
}

/** A stopped run's standing line: when, and after how long (walk f26). */
function stoppedLine(
	run: TranscriptRun,
	fallback: string | null,
): Extract<TranscriptItem, { kind: "end" }> {
	const at = run.completedAt ?? fallback;
	const took =
		run.startedAt && run.completedAt
			? seconds(run.startedAt, new Date(run.completedAt).getTime())
			: null;
	return {
		kind: "end",
		key: "stopped",
		tone: "stale",
		text: at ? `Stopped by you at ${formatClock(at)}` : "Stopped by you",
		detail: took !== null ? `after ${formatElapsed(took)}` : undefined,
	};
}

const LEVEL_OUTCOMES = new Set(["allowed", "mode_kept", "unattended"]);
const READS = new Set(["read", "search"]);

/** The one line an ask the level answered leaves; reads and searches leave none (#673 w21). */
function levelLine(
	event: Extract<CanonicalEvent, { kind: "permission_answer" }>,
	level: AccessLevel | null | undefined,
): Omit<Extract<TranscriptItem, { kind: "level" }>, "key"> | null {
	if (!LEVEL_OUTCOMES.has(event.outcome)) return null;
	const outcome = event.outcome as "allowed" | "mode_kept" | "unattended";
	const title = event.title ?? "A tool call";
	if (outcome === "allowed") {
		if (event.toolKind && READS.has(event.toolKind)) return null;
		return {
			kind: "level",
			outcome,
			text: level
				? `Allowed at ${ACCESS_LEVEL_LABEL[level]}: ${title}`
				: `Allowed: ${title}`,
		};
	}
	if (outcome === "unattended")
		return {
			kind: "level",
			outcome,
			text: `Refused, nobody was there to approve: ${title}`,
		};
	return {
		kind: "level",
		outcome,
		text: `Mode switch refused: ${title}`,
	};
}

/**
 * The conversation as chat (#743 §3c): the agent's prose, tool calls folded to
 * one line per group, `Thought for Ns` for gaps, operator blocks with their
 * delivery state, and one end line. PURE; `now` drives the live counters.
 */
export function deriveTranscript(
	events: CanonicalEvent[],
	now: number,
	opts: {
		run?: TranscriptRun;
		pending?: PendingMessage[];
		/** The picker's name for a model id (`haiku` reads `Haiku 5.5`, #673 w5-3). */
		modelName?: (id: string) => string;
	} = {},
): TranscriptItem[] {
	const { run, pending = [] } = opts;
	const items: TranscriptItem[] = [];
	let group: OpenGroup | null = null;
	let lastTs: string | null = null;
	let sawAgent = false;
	let sawError = false;
	let sawReport = false;
	// The run's first end (report, stop, failure) is its standing; any later end is a follow-up's.
	let sawEnd = false;
	let standingAt = -1;
	let lastFollowUpAt = -1;
	const operators: {
		item: Extract<TranscriptItem, { kind: "operator" }>;
		brief: boolean;
	}[] = [];
	const asks = new Map<string, boolean>();
	/** Which group lists each call: a late result or a re-announced call joins it (#673 w5-1). */
	const callGroup = new Map<string, OpenGroup>();
	const delegated = new Set<string>();
	const queued = new Map<
		string,
		Extract<CanonicalEvent, { kind: "message_queued" }>
	>();

	const groups: OpenGroup[] = [];
	const closeGroup = () => {
		group = null;
	};
	const openGroup = (key: string): OpenGroup => {
		if (group) return group;
		const item: Extract<TranscriptItem, { kind: "tools" }> = {
			kind: "tools",
			key: `tools-${key}`,
			count: 0,
			summary: "",
			failed: 0,
			running: 0,
			rows: [],
			callIds: [],
		};
		items.push(item);
		group = { item, calls: new Map() };
		groups.push(group);
		return group;
	};
	const refresh = (g: OpenGroup) => {
		const results = Array.from(g.calls.values());
		g.item.count = g.calls.size;
		g.item.callIds = Array.from(g.calls.keys());
		g.item.failed = results.filter((r) => r && !r.ok).length;
		g.item.running = results.filter((r) => !r).length;
		g.item.summary = summarizeTools(results, { ended: g.item.unfinished });
	};
	// A stopped or resumed turn left its open calls behind; none of them still runs (#673 walk 4, QA-07).
	const endOpenCalls = () => {
		for (const g of groups)
			if (g.item.running > 0 && !g.item.unfinished) {
				g.item.unfinished = true;
				refresh(g);
			}
	};
	const answerPending = () => {
		for (const o of operators) {
			if (
				!o.brief &&
				(o.item.state === "delivered" || o.item.state === "sent_now")
			) {
				o.item.state = "answered";
			}
		}
	};

	for (const event of events) {
		const key =
			event.kind === "report"
				? `report-${event.seq}`
				: `${event.branchId}-${event.seq}`;
		if (
			event.kind === "agent_step" &&
			lastTs &&
			seconds(lastTs, new Date(event.ts).getTime()) >= THOUGHT_GAP_S
		) {
			items.push({
				kind: "thought",
				key: `thought-${key}`,
				seconds: seconds(lastTs, new Date(event.ts).getTime()),
			});
			closeGroup();
		}
		lastTs = event.ts;

		switch (event.kind) {
			case "agent_step": {
				sawAgent = true;
				const { text, draft } = splitAgentText(event.text.trim());
				if (text === REPORT_DRAFTED || text === REPORT_CUT) {
					closeGroup();
					items.push({ kind: "line", key, text });
				} else if (text || draft) {
					closeGroup();
					items.push({
						kind: "prose",
						key,
						text,
						at: event.ts,
						...(draft ? { draft } : {}),
					});
					answerPending();
				}
				for (const call of event.toolCalls) {
					if (callGroup.has(call.toolCallId) || delegated.has(call.toolCallId))
						continue;
					if (DELEGATE_TOOL.test(call.name)) {
						delegated.add(call.toolCallId);
						closeGroup();
						items.push({
							kind: "line",
							key: `${key}-${call.toolCallId}`,
							text: `Delegated a sub-agent: ${delegateTitle(call)}`,
						});
						continue;
					}
					const g = openGroup(key);
					g.calls.set(call.toolCallId, null);
					callGroup.set(call.toolCallId, g);
					const row = canonicalEventToRow({ ...event, toolCalls: [call] });
					if (row)
						g.item.rows.push({
							...row,
							message: `${call.name}(${JSON.stringify(call.args)})`,
							key: `${key}-${call.toolCallId}`,
							callId: call.toolCallId,
						});
					refresh(g);
				}
				break;
			}
			case "tool_result": {
				const id = event.result.toolCallId;
				const g: OpenGroup = callGroup.get(id) ?? group ?? openGroup(key);
				callGroup.set(id, g);
				g.calls.set(id, event.result);
				const row = canonicalEventToRow(event);
				if (row) g.item.rows.push(row);
				refresh(g);
				break;
			}
			case "operator_message": {
				closeGroup();
				if (event.resumed) endOpenCalls();
				// A follow-up's first message is the boundary, whether or not the end before it was kept (#804 OBJ-028).
				if (event.resumed && !sawEnd) {
					sawEnd = true;
					if (run?.status === "cancelled") {
						standingAt = items.length;
						items.push(stoppedLine(run, null));
					} else if (run?.status === "failed") {
						standingAt = items.length;
						sawError = true;
						items.push({
							kind: "end",
							key: "failed",
							tone: "failed",
							text: `Failed: ${run.error ?? "no error was recorded"}`,
							error: run.error,
							at: run.completedAt ?? null,
							path: transcriptPath(run.id),
						});
					}
				}
				if (event.messageId) queued.delete(event.messageId);
				if (event.resumed)
					items.push({
						kind: "divider",
						key: `resumed-${key}`,
						text: resumedLine(event.resumed),
					});
				// The run's first message started it; it never waited for a pause (#673).
				const brief = !sawAgent && operators.length === 0;
				const item: Extract<TranscriptItem, { kind: "operator" }> = {
					kind: "operator",
					key,
					text: event.text,
					at: event.ts,
					mode: event.mode,
					attachments: event.attachments ?? [],
					state: !event.delivered
						? "not_delivered"
						: event.resumed
							? followUpState(event.followUp, run?.kind)
							: brief
								? "started"
								: event.mode === "now"
									? "sent_now"
									: "delivered",
				};
				// Send now takes the messages queued just before it in the same turn, so they went now too (#673 walk 4).
				if (item.state === "sent_now")
					for (let i = items.length - 1; i >= 0; i--) {
						const prev = items[i];
						if (prev?.kind !== "operator" || prev.state !== "delivered") break;
						prev.mode = "now";
					}
				operators.push({ item, brief });
				if (sawEnd) lastFollowUpAt = items.length;
				items.push(item);
				break;
			}
			case "branch_done":
				closeGroup();
				break;
			case "session_config":
				closeGroup();
				items.push({
					kind: "line",
					key,
					text: sessionConfigLine(
						event.option === "model" && opts.modelName
							? { ...event, value: opts.modelName(event.value) }
							: event,
					),
				});
				break;
			case "message_queued":
				queued.set(event.messageId, event);
				break;
			case "permission_ask":
				// The ask itself waits in the dock on the box; its step carries how it ended (#820).
				asks.set(event.askId, true);
				items.push({ kind: "ask", key, askId: event.askId });
				break;
			case "permission_answer": {
				if (asks.has(event.askId)) {
					asks.set(event.askId, false);
					break;
				}
				const line = levelLine(event, run?.accessLevel);
				if (line) {
					closeGroup();
					items.push({ ...line, key });
				}
				break;
			}
			case "error": {
				closeGroup();
				const first = !sawEnd;
				sawEnd = true;
				sawError = true;
				// A stopped run's own stop reads once, where it happened, as the standing (walk f26).
				if (first && run?.status === "cancelled") {
					standingAt = items.length;
					items.push(stoppedLine(run, event.ts));
					break;
				}
				// A message's own end on a thread whose standing it does not change (#673 w59, #804 OBJ-028).
				if (
					!first ||
					sawReport ||
					run?.kind === "chat" ||
					isStopMessage(event.message)
				) {
					items.push({
						kind: "end",
						key,
						tone: "stale",
						text: messageEndLine(event.message, event.ts),
					});
					break;
				}
				standingAt = items.length;
				items.push({
					kind: "end",
					key,
					tone: "failed",
					text: `Failed: ${event.message}`,
					error: event.message,
					at: event.ts,
					path: transcriptPath(run?.id),
				});
				break;
			}
			case "report":
				closeGroup();
				sawReport = true;
				sawEnd = true;
				items.push({
					kind: "end",
					key,
					tone: "done",
					text: "Report ready",
					report: true,
					recheck: run?.kind !== "chat",
				});
				break;
		}
	}

	for (const q of Array.from(queued.values()))
		items.push({
			kind: "operator",
			key: `queued-${q.messageId}`,
			text: q.text,
			at: q.ts,
			mode: "queue",
			attachments: q.attachments ?? [],
			// The run ended without reading it, and no record says so: it never arrived.
			state: run && !run.live ? "not_delivered" : "queued",
		});
	for (const p of unmatchedPending(events, pending)) {
		items.push({
			kind: "operator",
			key: `pending-${p.id}`,
			text: p.text,
			at: p.at,
			mode: p.mode,
			attachments: p.attachments ?? [],
			state: p.undelivered
				? "not_delivered"
				: p.mode === "now"
					? "sent_now"
					: "queued",
		});
	}

	const waiting = Array.from(asks.values()).filter(Boolean);
	if (run && !run.live) endOpenCalls();

	if (run?.live) {
		const last = items[items.length - 1];
		const toolRunning = last?.kind === "tools" && last.running > 0;
		if (run.stopRequested) {
			items.push({ kind: "line", key: "stopping", text: "Stopping…" });
		} else if (!sawAgent) {
			items.push({ kind: "line", key: "starting", text: "Starting…" });
		} else if (lastTs && !toolRunning && waiting.length === 0) {
			const s = seconds(lastTs, now);
			items.push({
				kind: "thinking",
				key: "thinking",
				seconds: s,
				stale: s > STALE_AFTER_S,
			});
		}
		return items;
	}

	if (run?.status === "cancelled" && standingAt < 0) {
		standingAt = items.length;
		items.push(stoppedLine(run, lastTs));
	} else if (run?.status === "failed" && standingAt < 0 && !sawError) {
		standingAt = items.length;
		items.push({
			kind: "end",
			key: "failed",
			tone: "failed",
			text: `Failed: ${run.error ?? "no error was recorded"}`,
			error: run.error,
			at: run.completedAt ?? lastTs,
			path: transcriptPath(run.id),
		});
	}
	// A follow-up whose own end was dropped still says how it ended (#804 OBJ-028).
	const lastEnd = items.findLastIndex((i) => i.kind === "end");
	if (
		run &&
		lastFollowUpAt > lastEnd &&
		(run.lastTurnOutcome === "error" || run.lastTurnOutcome === "stopped")
	)
		items.push({
			kind: "end",
			key: "last-message",
			tone: "stale",
			text:
				run.lastTurnOutcome === "stopped"
					? "Stopped by you"
					: "The agent stopped on your last message",
		});
	// What the box can do next sits under the last line, whichever it is.
	const hint = run && endHint(run);
	const tail = items.findLast((i) => i.kind === "end");
	if (hint && tail?.kind === "end") tail.hint = hint;

	if (items.length === 0) {
		return [
			{
				kind: "empty",
				key: "empty",
				text: "This investigation kept no events.",
			},
		];
	}
	return items;
}

/**
 * What the run is doing right now, for the strip (#743 §3c): the tool in
 * flight, `thinking`, or how long since the last step once that goes stale.
 */
export function runStepText(
	events: CanonicalEvent[],
	now: number,
	opts: { streamLost?: boolean } = {},
): { text: string; stale: boolean } | null {
	if (opts.streamLost)
		return { text: "live stream lost, polling", stale: true };
	const last = events.findLast((e) => e.kind !== "message_queued");
	if (!last) return null;
	// The agent waits on you; that quiet is not a stall (#673 w21).
	if (last.kind === "permission_ask")
		return { text: "waiting for your approval", stale: false };
	const age = seconds(last.ts, now);
	if (age > STALE_AFTER_S) {
		return { text: `no step for ${formatElapsed(age)}`, stale: true };
	}
	if (last.kind === "operator_message" && last.delivered) {
		return { text: "reading your message", stale: false };
	}
	if (last.kind === "agent_step" && last.toolCalls.length > 0) {
		const name = last.toolCalls[last.toolCalls.length - 1]?.name ?? "";
		return {
			text: name ? name.charAt(0).toLowerCase() + name.slice(1) : "thinking",
			stale: false,
		};
	}
	return { text: "thinking", stale: false };
}

/** The agent's latest sentence, from the newest step with prose. */
export function latestAgentText(events: CanonicalEvent[]): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e?.kind !== "agent_step") continue;
		const text = agentStepMessage(e.text.trim());
		if (text && text !== REPORT_DRAFTED && text !== REPORT_CUT) return text;
	}
	return null;
}

/**
 * Pending messages no event has answered yet: one carrying the API's id is
 * answered by any event with that id; an older one by an operator_message with its text.
 */
export function unmatchedPending(
	events: ReadonlyArray<CanonicalEvent>,
	pending: ReadonlyArray<PendingMessage>,
): PendingMessage[] {
	const ids = new Set<string>();
	const left = new Map<string, number>();
	for (const e of events) {
		if (e.kind === "message_queued") ids.add(e.messageId);
		if (e.kind !== "operator_message") continue;
		if (e.messageId) ids.add(e.messageId);
		const t = e.text.trim();
		left.set(t, (left.get(t) ?? 0) + 1);
	}
	return pending.filter((p) => {
		if (p.undelivered) return true;
		if (p.messageId) return !ids.has(p.messageId);
		const t = p.text.trim();
		const n = left.get(t) ?? 0;
		if (n === 0) return true;
		left.set(t, n - 1);
		return false;
	});
}

/** Messages waiting for the agent's next pause, recorded by the run or just sent (#820). */
export function queuedMessages(
	events: ReadonlyArray<CanonicalEvent>,
	pending: ReadonlyArray<PendingMessage>,
): { key: string; text: string; attachments: AttachmentView[] }[] {
	const open = new Map<
		string,
		Extract<CanonicalEvent, { kind: "message_queued" }>
	>();
	for (const e of events) {
		if (e.kind === "message_queued") open.set(e.messageId, e);
		else if (e.kind === "operator_message" && e.messageId)
			open.delete(e.messageId);
	}
	return [
		...Array.from(open.values()).map((q) => ({
			key: q.messageId,
			text: q.text,
			attachments: q.attachments ?? [],
		})),
		...unmatchedPending(events, pending)
			.filter((m) => m.mode === "queue" && !m.undelivered)
			.map((m) => ({
				key: m.id,
				text: m.text,
				attachments: m.attachments ?? [],
			})),
	];
}
