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
import type { CanonicalEvent, StreamToolResult } from "@prismalens/contracts";
import { InvestigationReportSchema } from "@prismalens/contracts/schemas";
import { formatClock, formatElapsed } from "./format-time";

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
}

export const REPORT_DRAFTED = "Report drafted";

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
 * `InvestigationReportSchema` rather than the engine's `ModelReportSchema`:
 * the two differ only by `fidelity`, which is host-stamped and optional here,
 * so this schema accepts the model's own draft *and* the stamped report — and
 * it lives in `@prismalens/contracts`, which the browser bundle already
 * carries, while the engine is server-only.
 *
 * Only a COMPLETE object is recognised. See {@link agentStepMessage} for what
 * that means for a partial one.
 */
function isReportJson(body: string): boolean {
	const trimmed = body.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	try {
		return InvestigationReportSchema.safeParse(JSON.parse(trimmed)).success;
	} catch {
		return false;
	}
}

/**
 * The agent's last text is the report itself, as JSON: bare, fenced, or after
 * a line of prose (#659). The panel names that step instead of printing the
 * document; every other text shows as written. A fence closes only on its own
 * line, so a backtick run inside a JSON string does not end the block early.
 *
 * ## Partial text
 *
 * This never sees a half-written report through the live stream. Assistant text
 * arrives from ACP as incremental `agent_message_chunk` deltas, and
 * `AcpAdapter` is the one place they accumulate: it flushes them as the `text`
 * of a single `agent_step`, so a canonical event always carries a whole turn.
 * The panel appends those events and upserts rows by `(branchId, seq)` for
 * replay idempotency — it never grows one row's text in place. So there is no
 * window in which a row holds an incomplete object, and nothing flashes raw
 * JSON mid-stream.
 *
 * If a future harness did split a report across two steps, the fragment would
 * fail `JSON.parse` and be shown as written rather than swallowed. That is the
 * deliberate choice: an unparseable fragment is indistinguishable from prose
 * that happens to start with `{`, and hiding text we cannot identify is the
 * worse failure — it loses the agent's words with no way to get them back,
 * whereas showing a fragment is merely ugly for one row.
 */
export function agentStepMessage(text: string): string {
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
	return text;
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
	| "queued"
	| "sent_now"
	| "delivered"
	| "answered"
	| "not_delivered";

/** The ruling's words for an operator message's delivery (#743 §3c). */
export const OPERATOR_STATE_LABEL: Record<OperatorState, string> = {
	queued: "Queued",
	sent_now: "Sent now",
	delivered: "Delivered",
	answered: "Answered",
	not_delivered: "Not delivered",
};

/** A message the API accepted that has not come back as an event yet. */
export interface PendingMessage {
	id: string;
	text: string;
	mode: "queue" | "now";
	at: string;
	undelivered?: boolean;
}

export interface TranscriptRun {
	status: string;
	live: boolean;
	stopRequested?: boolean;
	error?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	id?: string;
}

export type TranscriptItem =
	| { kind: "prose"; key: string; text: string }
	| { kind: "line"; key: string; text: string }
	| {
			kind: "tools";
			key: string;
			count: number;
			summary: string;
			failed: number;
			running: number;
			rows: EventRow[];
	  }
	| { kind: "thought"; key: string; seconds: number }
	| { kind: "thinking"; key: string; seconds: number; stale: boolean }
	| {
			kind: "operator";
			key: string;
			text: string;
			at: string;
			state: OperatorState;
	  }
	| {
			kind: "end";
			key: string;
			tone: "done" | "failed" | "stale";
			text: string;
			detail?: string;
			report?: boolean;
			path?: string;
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

/** `read 2 files, searched 1 pattern`: what a tool group did, by category. */
export function summarizeTools(results: (StreamToolResult | null)[]): string {
	let file = 0;
	let search = 0;
	let source = 0;
	let other = 0;
	let running = 0;
	for (const r of results) {
		if (!r) running++;
		else if (r.toolCategory === "file") file++;
		else if (r.toolCategory === "search") search++;
		else if (r.toolCategory) source++;
		else other++;
	}
	const parts: string[] = [];
	if (file) parts.push(`read ${plural(file, "file", "files")}`);
	if (search) parts.push(`searched ${plural(search, "pattern", "patterns")}`);
	if (source) parts.push(`queried ${plural(source, "source", "sources")}`);
	if (other) parts.push(`ran ${plural(other, "command", "commands")}`);
	if (running) parts.push(`${running} running`);
	return parts.join(", ");
}

function delegateTitle(call: { name: string; args: Record<string, unknown> }) {
	const d = call.args.description;
	return typeof d === "string" && d.trim() ? d.trim() : call.name;
}

function transcriptPath(runId?: string): string {
	return `runs/${runId ?? "<id>"}/transcript.jsonl`;
}

/**
 * The conversation as chat (#743 §3c): the agent's prose, tool calls folded to
 * one line per group, `Thought for Ns` for gaps, operator blocks with their
 * delivery state, and one end line. PURE; `now` drives the live counters.
 */
export function deriveTranscript(
	events: CanonicalEvent[],
	now: number,
	opts: { run?: TranscriptRun; pending?: PendingMessage[] } = {},
): TranscriptItem[] {
	const { run, pending = [] } = opts;
	const items: TranscriptItem[] = [];
	let group: OpenGroup | null = null;
	let lastTs: string | null = null;
	let sawAgent = false;
	let sawError = false;
	const operators: {
		item: Extract<TranscriptItem, { kind: "operator" }>;
		brief: boolean;
	}[] = [];

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
		};
		items.push(item);
		group = { item, calls: new Map() };
		return group;
	};
	const refresh = (g: OpenGroup) => {
		const results = Array.from(g.calls.values());
		g.item.count = g.calls.size;
		g.item.failed = results.filter((r) => r && !r.ok).length;
		g.item.running = results.filter((r) => !r).length;
		g.item.summary = summarizeTools(results);
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
				const text = agentStepMessage(event.text.trim());
				if (text === REPORT_DRAFTED) {
					closeGroup();
					items.push({ kind: "line", key, text: REPORT_DRAFTED });
				} else if (text) {
					closeGroup();
					items.push({ kind: "prose", key, text });
					answerPending();
				}
				for (const call of event.toolCalls) {
					if (DELEGATE_TOOL.test(call.name)) {
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
					const row = canonicalEventToRow({ ...event, toolCalls: [call] });
					if (row)
						g.item.rows.push({ ...row, key: `${key}-${call.toolCallId}` });
					refresh(g);
				}
				break;
			}
			case "tool_result": {
				const g: OpenGroup = group ?? openGroup(key);
				g.calls.set(event.result.toolCallId, event.result);
				const row = canonicalEventToRow(event);
				if (row) g.item.rows.push(row);
				refresh(g);
				break;
			}
			case "operator_message": {
				closeGroup();
				const item: Extract<TranscriptItem, { kind: "operator" }> = {
					kind: "operator",
					key,
					text: event.text,
					at: event.ts,
					state: !event.delivered
						? "not_delivered"
						: event.mode === "now"
							? "sent_now"
							: "delivered",
				};
				operators.push({ item, brief: !sawAgent && operators.length === 0 });
				items.push(item);
				break;
			}
			case "branch_done":
				closeGroup();
				items.push({ kind: "line", key, text: `Finished: ${event.reason}` });
				break;
			case "error":
				closeGroup();
				sawError = true;
				items.push({
					kind: "end",
					key,
					tone: "failed",
					text: `Failed: ${event.message}`,
					path: transcriptPath(run?.id),
				});
				break;
			case "report":
				closeGroup();
				items.push({
					kind: "end",
					key,
					tone: "done",
					text: "Report ready",
					report: true,
				});
				break;
		}
	}

	for (const p of unmatchedPending(events, pending)) {
		items.push({
			kind: "operator",
			key: `pending-${p.id}`,
			text: p.text,
			at: p.at,
			state: p.undelivered
				? "not_delivered"
				: p.mode === "now"
					? "sent_now"
					: "queued",
		});
	}

	if (run?.live) {
		const last = items[items.length - 1];
		const toolRunning = last?.kind === "tools" && last.running > 0;
		if (run.stopRequested) {
			items.push({ kind: "line", key: "stopping", text: "Stopping…" });
		} else if (!sawAgent) {
			items.push({ kind: "line", key: "starting", text: "Starting…" });
		} else if (lastTs && !toolRunning) {
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

	if (run?.status === "cancelled") {
		const at = run.completedAt ?? lastTs;
		const took =
			run.startedAt && run.completedAt
				? seconds(run.startedAt, new Date(run.completedAt).getTime())
				: null;
		items.push({
			kind: "end",
			key: "stopped",
			tone: "stale",
			text: at ? `Stopped by you at ${formatClock(at)}` : "Stopped by you",
			detail: took !== null ? `after ${formatElapsed(took)}` : undefined,
		});
	} else if (run?.status === "failed" && !sawError) {
		items.push({
			kind: "end",
			key: "failed",
			tone: "failed",
			text: `Failed: ${run.error ?? "no error was recorded"}`,
			path: transcriptPath(run.id),
		});
	}

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
	const last = events[events.length - 1];
	if (!last) return null;
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
		if (text && text !== REPORT_DRAFTED) return text;
	}
	return null;
}

/** Pending messages no event has answered yet: each operator_message event answers one pending message with its text. */
export function unmatchedPending(
	events: ReadonlyArray<CanonicalEvent>,
	pending: ReadonlyArray<PendingMessage>,
): PendingMessage[] {
	const left = new Map<string, number>();
	for (const e of events) {
		if (e.kind !== "operator_message") continue;
		const t = e.text.trim();
		left.set(t, (left.get(t) ?? 0) + 1);
	}
	return pending.filter((p) => {
		if (p.undelivered) return true;
		const t = p.text.trim();
		const n = left.get(t) ?? 0;
		if (n === 0) return true;
		left.set(t, n - 1);
		return false;
	});
}
