// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	anchorIdsOf,
	anchorRefOf,
	type CanonicalEvent,
	comparePosition,
	type IndexAuthor,
	type IndexEntry,
	type IndexTurn,
	indexEntryOf,
	rowKey,
	turnAuthorOf,
} from "@prismalens/contracts";

/** One stored event, light: enough to page, fold, index and count without its payload. */
export interface LightEntry {
	key: string;
	branchId: string;
	seq: number;
	ordinal: number;
	kind: string;
	ts: string | null;
	/** Bytes of the stored JSON. */
	bytes: number;
	/** The key of the event this one belongs beside; its own key when none. */
	anchor: string;
	/** Who opens a turn here, when the event starts one. */
	boundary: IndexAuthor | null;
	entry: IndexEntry | null;
	/** Tool calls the event opens, and whether it is a failed result. */
	steps: number;
	failed: boolean;
	/** A turn's end the transcript reads as the run's standing (report, error). */
	end: boolean;
	/** The main agent wrote prose here. */
	prose: boolean;
	/** Kinds a finished turn's fold hides. */
	work: boolean;
}

export interface Turn {
	/** Index of the first entry, by position. */
	start: number;
	/** Index past the last entry. */
	end: number;
	summary: IndexTurn;
}

/** A thread's light projection at one `(gen, revision)`. */
export interface Projection {
	gen: number;
	revision: number;
	lost: number;
	entries: LightEntry[];
	/** key → index in `entries`. */
	at: Map<string, number>;
	/** Entry index → index of its anchor. */
	anchorAt: Int32Array;
	/** Anchor index → entries anchored to it that sit elsewhere. */
	dependents: Map<number, number[]>;
	/** Entry index → turn index. */
	turnOf: Int32Array;
	turns: Turn[];
	/** Running totals before each entry index: steps, ends, operator messages, any prose. */
	stepsBefore: Int32Array;
	endsBefore: Int32Array;
	operatorsBefore: Int32Array;
	proseBefore: Int32Array;
}

const WORK_KINDS = new Set([
	"tool_result",
	"thought",
	"harness_tool_call",
	"harness_tools",
	"finding_recorded",
	"permission_ask",
	"permission_answer",
	"plan",
	"session_config",
	"subagent",
]);

/** The light entry of one stored row; `event` is already parsed. */
export function lightEntry(
	row: { seq: number; branchId: string; ordinal: number; bytes: number },
	event: CanonicalEvent,
): LightEntry {
	const key = rowKey(row.branchId, row.seq);
	const ref = anchorRefOf(event);
	const prose =
		event.kind === "agent_step" &&
		event.path.length === 0 &&
		event.text.trim().length > 0;
	return {
		key,
		branchId: row.branchId,
		seq: row.seq,
		ordinal: row.ordinal,
		kind: event.kind,
		ts: "ts" in event ? event.ts : null,
		bytes: row.bytes,
		// Resolved against the opener map once every entry is known.
		anchor: ref ? `${ref.kind}#${ref.id}` : key,
		boundary: turnAuthorOf(event),
		entry: indexEntryOf(event),
		steps:
			event.kind === "agent_step"
				? event.path.length === 0
					? event.toolCalls.length
					: 0
				: event.kind === "harness_tool_call"
					? 1
					: 0,
		failed: event.kind === "tool_result" && !event.result.ok,
		end: event.kind === "report" || event.kind === "error",
		prose,
		work:
			WORK_KINDS.has(event.kind) ||
			(event.kind === "agent_step" && !prose) ||
			(event.kind === "agent_step" && event.toolCalls.length > 0),
	};
}

/** The ids each entry opens, kept so a later row's anchor resolves to it. */
export function openerIds(event: CanonicalEvent): string[] {
	return anchorIdsOf(event).map((a) => `${a.kind}#${a.id}`);
}

/**
 * Index the light entries: order, anchors, turns and running totals. O(n) over light
 * data, so a new revision recomputes it whole rather than patching earlier turns (#1101).
 */
export function buildProjection(
	gen: number,
	revision: number,
	lost: number,
	unsorted: LightEntry[],
	openers: Map<string, string>,
): Projection {
	const entries = [...unsorted].sort(comparePosition);
	const n = entries.length;
	const at = new Map<string, number>();
	entries.forEach((e, i) => {
		at.set(e.key, i);
	});

	const anchorAt = new Int32Array(n);
	const dependents = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const e = entries[i] as LightEntry;
		let a = i;
		if (e.anchor !== e.key) {
			const opener = openers.get(e.anchor);
			const j = opener === undefined ? undefined : at.get(opener);
			// Only an earlier opener anchors: a result before its call stays where it is.
			if (j !== undefined && j < i) a = j;
		}
		anchorAt[i] = a;
		if (a !== i) {
			const list = dependents.get(a);
			if (list) list.push(i);
			else dependents.set(a, [i]);
		}
	}

	const turnOf = new Int32Array(n);
	const turns: Turn[] = [];
	for (let i = 0; i < n; i++) {
		const e = entries[i] as LightEntry;
		if (i === 0 || e.boundary) {
			const last = turns[turns.length - 1];
			if (last) last.end = i;
			turns.push({
				start: i,
				end: n,
				summary: {
					key: e.key,
					author: e.boundary ?? "system",
					at: e.ts ?? "",
					steps: 0,
					failed: 0,
					seconds: null,
					events: 0,
				},
			});
		}
		turnOf[i] = turns.length - 1;
	}
	// Totals count each event in its anchor's turn, the turn it is drawn in.
	const firstTs: (number | null)[] = turns.map(() => null);
	const lastTs: (number | null)[] = turns.map(() => null);
	for (let i = 0; i < n; i++) {
		const e = entries[i] as LightEntry;
		const t = turnOf[anchorAt[i] as number] as number;
		const s = (turns[t] as Turn).summary;
		s.steps += e.steps;
		if (e.failed) s.failed += 1;
		s.events += 1;
		const ms = e.ts ? Date.parse(e.ts) : Number.NaN;
		if (!Number.isNaN(ms)) {
			const f = firstTs[t];
			const l = lastTs[t];
			if (f === null || f === undefined || ms < f) firstTs[t] = ms;
			if (l === null || l === undefined || ms > l) lastTs[t] = ms;
		}
	}
	turns.forEach((t, i) => {
		const f = firstTs[i];
		const l = lastTs[i];
		if (f != null && l != null)
			t.summary.seconds = Math.max(0, Math.round((l - f) / 1000));
	});

	const stepsBefore = new Int32Array(n + 1);
	const endsBefore = new Int32Array(n + 1);
	const operatorsBefore = new Int32Array(n + 1);
	const proseBefore = new Int32Array(n + 1);
	for (let i = 0; i < n; i++) {
		const e = entries[i] as LightEntry;
		stepsBefore[i + 1] = (stepsBefore[i] as number) + e.steps;
		endsBefore[i + 1] = (endsBefore[i] as number) + (e.end ? 1 : 0);
		operatorsBefore[i + 1] =
			(operatorsBefore[i] as number) + (e.kind === "operator_message" ? 1 : 0);
		proseBefore[i + 1] = (proseBefore[i] as number) + (e.prose ? 1 : 0);
	}

	return {
		gen,
		revision,
		lost,
		entries,
		at,
		anchorAt,
		dependents,
		turnOf,
		turns,
		stepsBefore,
		endsBefore,
		operatorsBefore,
		proseBefore,
	};
}
