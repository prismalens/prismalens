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

/** Map one canonical event to a row, or null when it shouldn't be shown. */
export function canonicalEventToRow(event: CanonicalEvent): EventRow | null {
	switch (event.kind) {
		case "agent_step": {
			const key = `${event.branchId}-${event.seq}`;
			const text = event.text.trim();
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

		// llm_call is run-level bookkeeping with no branchId (ADR-0002 — not
		// evidence, never a branch row). canonicalEventToRow already returns null
		// for it, so this is unreachable at runtime; it exists to narrow the kind
		// out of the union before the branchId accesses below.
		if (event.kind === "llm_call") continue;

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
