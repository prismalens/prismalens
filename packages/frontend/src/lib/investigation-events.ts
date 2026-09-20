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
import type { CanonicalEvent } from "@prismalens/contracts";
import { InvestigationReportSchema } from "@prismalens/contracts/schemas";

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

const REPORT_DRAFTED = "Report drafted";

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
