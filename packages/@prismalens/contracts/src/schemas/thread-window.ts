// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A long thread read in windows (#1101 categories 12-14): the page, the light
 * whole-thread index the rail draws, find, and the resumable stream's frames.
 */
import { z } from "zod";
import { lazySchema } from "../lazy-schema.js";
import { PendingAskSchema } from "./asks.js";
import {
	type CanonicalEvent,
	CanonicalEventSchema,
	INVESTIGATION_REPORT_BRANCH,
	RecordedHypothesisSchema,
} from "./investigation.js";
import { type FailureMode, failureLine } from "./provider-failure.js";

// ---- identity and position ----

/** An event's identity: `branch:seq`, or `report:seq` for the terminal report. */
export function eventKey(e: CanonicalEvent): string {
	return e.kind === "report" ? `report:${e.seq}` : `${e.branchId}:${e.seq}`;
}

/** The key a stored row carries, from its columns. */
export function rowKey(branchId: string, seq: number): string {
	return branchId === INVESTIGATION_REPORT_BRANCH
		? `report:${seq}`
		: `${branchId}:${seq}`;
}

/** A key's `(seq, branchId)`; the branch is everything before the last colon. */
export function parseEventKey(
	key: string,
): { branchId: string; seq: number } | null {
	const at = key.lastIndexOf(":");
	if (at <= 0) return null;
	const seq = Number(key.slice(at + 1));
	if (!Number.isInteger(seq)) return null;
	const branch = key.slice(0, at);
	return {
		branchId: branch === "report" ? INVESTIGATION_REPORT_BRANCH : branch,
		seq,
	};
}

/** Display order: `(seq, branchId)`, the order the record has always been read in. */
export function comparePosition(
	a: { seq: number; branchId: string },
	b: { seq: number; branchId: string },
): number {
	if (a.seq !== b.seq) return a.seq - b.seq;
	return a.branchId < b.branchId ? -1 : a.branchId > b.branchId ? 1 : 0;
}

export function compareKeys(a: string, b: string): number {
	const pa = parseEventKey(a);
	const pb = parseEventKey(b);
	if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
	return comparePosition(pa, pb);
}

export const EventKeySchema = /* @__PURE__ */ lazySchema(() =>
	z
		.string()
		.min(3)
		.max(300)
		.refine((k) => parseEventKey(k) !== null, "Not an event key"),
);

/** `<generation>.<ordinal>`: where a stream resumes; ordinals are commit order (#1101 cat 12). */
export const StreamCursorSchema = /* @__PURE__ */ lazySchema(() =>
	z.string().regex(/^\d{1,9}\.\d{1,12}$/, "Not a stream cursor"),
);

export function parseCursor(
	cursor: string,
): { gen: number; ordinal: number } | null {
	const m = /^(\d{1,9})\.(\d{1,12})$/.exec(cursor);
	return m ? { gen: Number(m[1]), ordinal: Number(m[2]) } : null;
}

// ---- the light index (the rail) ----

/** Who wrote a message: you, the agent, another thread, or PrismaLens itself. */
export const INDEX_AUTHORS = ["you", "agent", "thread", "system"] as const;
export type IndexAuthor = (typeof INDEX_AUTHORS)[number];

/** Thread-breaking and thread-producing events the rail marks by shape and tone. */
export const RAIL_MARKS = [
	"compaction",
	"usage_limit",
	"rate_limit",
	"auth",
	"blocked",
	"restart",
	"error",
	"report",
	"child",
	"pr",
] as const;
export type RailMark = (typeof RAIL_MARKS)[number];

/** Characters of a message's start the index keeps for the rail's preview. */
export const INDEX_PREVIEW_CHARS = 80;

/** `[key, author, mark, preview, at, detail]`: one message or mark; tuples keep 5,000 items small. */
export const IndexEntrySchema = /* @__PURE__ */ lazySchema(() =>
	z.tuple([
		z.string(),
		z.enum(INDEX_AUTHORS),
		z.enum(RAIL_MARKS).nullable(),
		z.string(),
		z.string(),
		/** A mark's own detail, e.g. a usage limit's reset time (ISO). */
		z.string().nullable(),
	]),
);
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

/** One turn: from a message to the next; enough to draw a folded turn without its contents. */
export const IndexTurnSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		/** The boundary event's key; the record's start uses its first event. */
		key: z.string(),
		author: z.enum(INDEX_AUTHORS),
		at: z.string(),
		/** Tool calls in the turn, and those that failed. */
		steps: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		/** From its first event to its last, when both carry a time. */
		seconds: z.number().int().nonnegative().nullable(),
		/** Events the turn holds, by anchor. */
		events: z.number().int().nonnegative(),
	}),
);
export type IndexTurn = z.infer<typeof IndexTurnSchema>;

export const ThreadIndexSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		revision: z.number().int(),
		/** Every event the record holds. */
		total: z.number().int(),
		/** Events a run could not store this generation: the record is incomplete when above 0. */
		lost: z.number().int().nonnegative(),
		turns: z.array(IndexTurnSchema),
		entries: z.array(IndexEntrySchema),
	}),
);
export type ThreadIndex = z.infer<typeof ThreadIndexSchema>;

const AUTH_FAILURE =
	/\b(api[ _-]?key|unauthori[sz]ed|authentication|invalid (?:x-)?api|401|revoked|credentials?)\b/i;

function preview(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > INDEX_PREVIEW_CHARS
		? `${flat.slice(0, INDEX_PREVIEW_CHARS - 1)}…`
		: flat;
}

/** The rail entry an event makes, or null: messages get a tick, breaks and products a mark. */
export function indexEntryOf(e: CanonicalEvent): IndexEntry | null {
	const key = eventKey(e);
	switch (e.kind) {
		case "operator_message":
			if (e.via?.restart)
				return [
					key,
					"system",
					"restart",
					"Interrupted by restart",
					e.ts,
					e.via.restart.stoppedAt,
				];
			return [key, "you", null, preview(e.text), e.ts, null];
		case "agent_step": {
			if (e.path.length > 0 || !e.text.trim()) return null;
			return [key, "agent", null, preview(e.text), e.ts, null];
		}
		case "thread_message":
			return e.direction === "received"
				? [key, "thread", null, preview(e.text), e.ts, null]
				: null;
		case "compaction":
			return e.phase === "started"
				? null
				: [
						key,
						"system",
						"compaction",
						e.phase === "failed" ? "Compaction failed" : "Context compacted",
						e.ts,
						null,
					];
		// A stop's line is built from its classification, never the stored text, which
		// on older or seeded records is the agent's raw words ("(401)", parser codes).
		case "usage_limit": {
			const mode = e.mode ?? "usage_limit";
			const mark = stopMark(mode);
			return [
				key,
				"system",
				mark,
				failureLine({ mode, window: e.window }, e.agent),
				e.ts,
				mark === "usage_limit" ? (e.resetsAt ?? null) : (e.mode ?? null),
			];
		}
		case "provider_blocked":
			return [
				key,
				"system",
				stopMark(e.mode),
				failureLine({ mode: e.mode }, e.agent),
				e.ts,
				e.mode,
			];
		case "run_interrupted":
			return [key, "system", "restart", "Interrupted by restart", e.ts, null];
		case "error": {
			// A classified stop names itself; an unclassified one only says it was an error.
			const mode =
				e.failure?.mode ??
				(AUTH_FAILURE.test(e.message) ? ("key_rejected" as const) : undefined);
			return [
				key,
				"system",
				mode ? stopMark(mode) : "error",
				mode ? failureLine({ mode, window: e.failure?.window }) : "Error",
				e.ts,
				mode && mode !== "usage_limit" ? mode : null,
			];
		}
		case "resumed":
			return null;
		case "report":
			return [key, "agent", "report", "Report", e.ts, null];
		case "pull_request_linked":
			return [key, "system", "pr", preview(e.url), e.ts, null];
		default:
			return null;
	}
}

/** The rail mark a provider stop draws (#1101 categories 14 and 17). */
export function stopMark(mode: FailureMode): RailMark {
	switch (mode) {
		case "usage_limit":
			return "usage_limit";
		case "rate_limited":
		case "overloaded":
			return "rate_limit";
		case "key_rejected":
			return "auth";
		case "out_of_credit":
		case "spend_cap":
			return "blocked";
	}
}

/** Who opens a turn, when the event does; null when it does not start one. */
export function turnAuthorOf(e: CanonicalEvent): IndexAuthor | null {
	if (e.kind === "operator_message") return e.via?.restart ? "system" : "you";
	if (e.kind === "thread_message" && e.direction === "received")
		return "thread";
	return null;
}

/**
 * The earlier event an event belongs beside, by kind and id: a late tool result
 * joins its call, an answer its ask, a queue edit its message (#1101 cat 12).
 */
export function anchorRefOf(
	e: CanonicalEvent,
): { kind: "call" | "ask" | "queued"; id: string } | null {
	switch (e.kind) {
		case "tool_result":
			return { kind: "call", id: e.result.toolCallId };
		case "permission_answer":
		case "ask_closed":
			return { kind: "ask", id: e.askId };
		case "message_edited":
		case "message_withdrawn":
			return { kind: "queued", id: e.messageId };
		default:
			return null;
	}
}

/** The ids an event opens that later events anchor to. */
export function anchorIdsOf(
	e: CanonicalEvent,
): { kind: "call" | "ask" | "queued"; id: string }[] {
	switch (e.kind) {
		case "agent_step":
			return e.toolCalls.map((c) => ({
				kind: "call" as const,
				id: c.toolCallId,
			}));
		case "harness_tool_call":
			return e.callId ? [{ kind: "call", id: e.callId }] : [];
		case "permission_ask":
			return [{ kind: "ask", id: e.askId }];
		case "ask_opened":
			return [{ kind: "ask", id: e.ask.askId }];
		case "message_queued":
			return [{ kind: "queued", id: e.messageId }];
		default:
			return [];
	}
}

// ---- find ----

export const FIND_SCOPES = ["all", "mine", "agent", "tools"] as const;
export type FindScope = (typeof FIND_SCOPES)[number];
export const FIND_QUERY_MAX = 200;

/** The text find reads in one event for a scope; empty when the scope does not cover it. */
export function searchableText(e: CanonicalEvent, scope: FindScope): string[] {
	const mine = scope === "all" || scope === "mine";
	const agent = scope === "all" || scope === "agent";
	const tools = scope === "all" || scope === "tools";
	switch (e.kind) {
		case "operator_message":
			return mine && !e.via?.restart ? [e.text] : [];
		case "message_queued":
			return [];
		case "thread_message":
			return agent ? [e.text] : [];
		case "agent_step": {
			const out: string[] = [];
			if (agent && e.text) out.push(e.text);
			if (tools)
				for (const c of e.toolCalls)
					out.push(`${c.name}(${JSON.stringify(c.args)})`);
			return out;
		}
		case "thought":
			return agent ? [e.text] : [];
		case "tool_result":
			return tools
				? [e.result.source, e.result.preview, e.result.error ?? ""].filter(
						Boolean,
					)
				: [];
		case "harness_tool_call":
			return tools ? [e.name, e.output ?? ""].filter(Boolean) : [];
		case "error":
			return agent ? [e.message] : [];
		case "usage_limit":
		case "provider_blocked":
			return agent ? [e.text] : [];
		default:
			return [];
	}
}

/**
 * Fold for a case-blind match, per code point, keeping where each folded unit
 * came from: `İ` lowercases to two units, and offsets must land in the original.
 */
export function foldWithMap(text: string): { folded: string; from: number[] } {
	let folded = "";
	const from: number[] = [];
	let i = 0;
	for (const ch of text) {
		const low = ch.toLowerCase();
		folded += low;
		for (let u = 0; u < low.length; u++) from.push(i);
		i += ch.length;
	}
	from.push(text.length);
	return { folded, from };
}

/** Each occurrence of `q` in `text` as `[start, end)` in the original text; never overlapping. */
export function findOccurrences(
	text: string,
	q: string,
	opts: { caseSensitive?: boolean } = {},
): [number, number][] {
	if (!q) return [];
	const out: [number, number][] = [];
	if (opts.caseSensitive) {
		for (
			let at = text.indexOf(q);
			at !== -1;
			at = text.indexOf(q, at + q.length)
		)
			out.push([at, at + q.length]);
		return out;
	}
	// Per code point on both sides: a whole-string fold is context-dependent (final sigma).
	const needle = foldWithMap(q).folded;
	const { folded, from } = foldWithMap(text);
	for (
		let at = folded.indexOf(needle);
		at !== -1;
		at = folded.indexOf(needle, at + needle.length)
	) {
		const start = from[at] as number;
		const last = from[at + needle.length - 1] as number;
		// The end is past the original code point the match's last unit came from.
		const end = last + ((text.codePointAt(last) as number) > 0xffff ? 2 : 1);
		if (out.length && (out[out.length - 1] as [number, number])[1] > start)
			continue;
		out.push([start, end]);
	}
	return out;
}

export function countOccurrences(
	texts: readonly string[],
	q: string,
	opts: { caseSensitive?: boolean } = {},
): number {
	let n = 0;
	for (const t of texts) n += findOccurrences(t, q, opts).length;
	return n;
}

// ---- pages ----

/** A query-string flag: only `true` is true; `z.coerce.boolean` reads "false" as true. */
export const QueryFlagSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
		.optional(),
);

/** A field cut to keep a page small; `eventFull` returns the event whole. */
export const CutFieldSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		path: z.string(),
		bytes: z.number().int().nonnegative(),
	}),
);
export type CutField = z.infer<typeof CutFieldSchema>;

export const PageItemSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		key: z.string(),
		ordinal: z.number().int(),
		event: CanonicalEventSchema,
		/** Present when a field was cut: the event is a preview, not the record. */
		cut: z.array(CutFieldSchema).optional(),
	}),
);
export type PageItem = z.infer<typeof PageItemSchema>;

/** A finished turn sent without its work; opening it reads the turn's page. */
export const FoldedTurnSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		turnKey: z.string(),
		steps: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		seconds: z.number().int().nonnegative().nullable(),
		/** Events left out. */
		hidden: z.number().int().nonnegative(),
	}),
);
export type FoldedTurn = z.infer<typeof FoldedTurnSchema>;

/** What the record held before the page's first position, so a mid-record page derives the same rows. */
export const PageContextSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		stepsBefore: z.number().int().nonnegative(),
		endsBefore: z.number().int().nonnegative(),
		operatorsBefore: z.number().int().nonnegative(),
		agentBefore: z.boolean(),
	}),
);
export type PageContext = z.infer<typeof PageContextSchema>;

export const ThreadPageSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		revision: z.number().int(),
		/** First and last positions the page covers; null on an empty record. */
		lo: z.string().nullable(),
		hi: z.string().nullable(),
		hasBefore: z.boolean(),
		hasAfter: z.boolean(),
		items: z.array(PageItemSchema),
		context: PageContextSchema,
		folded: z.array(FoldedTurnSchema),
		/** The item the page was read around, when it was asked for one. */
		target: z.string().nullable(),
	}),
);
export type ThreadPage = z.infer<typeof ThreadPageSchema>;

/** Thread-wide state a window cannot derive, read from the whole record once. */
export const ThreadStateSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		openAsks: z.array(PendingAskSchema),
		queue: z.array(
			z.object({
				messageId: z.string(),
				text: z.string(),
				at: z.string(),
			}),
		),
		hypotheses: z.array(RecordedHypothesisSchema),
	}),
);
export type ThreadState = z.infer<typeof ThreadStateSchema>;

export const OpenThreadInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		/** Open at this item, by key or by its seq alone (`#item-1234`); the tail when absent. */
		at: z.union([EventKeySchema, z.string().regex(/^\d{1,12}$/)]).optional(),
		/** A named position a resolver answers, e.g. `unread` (#1101 cat 3); the tail when none does. */
		position: z.string().min(1).max(40).optional(),
		/** Ship finished turns folded (bar 12.5). */
		fold: QueryFlagSchema,
	}),
);
export type OpenThreadInput = z.infer<typeof OpenThreadInputSchema>;

export const OpenThreadSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		revision: z.number().int(),
		index: ThreadIndexSchema,
		page: ThreadPageSchema,
		state: ThreadStateSchema,
		/** Where it opened: the item asked for, the resolved position's item, or null for the tail. */
		landing: z.string().nullable(),
	}),
);
export type OpenThread = z.infer<typeof OpenThreadSchema>;

export const ThreadPageInputSchema = /* @__PURE__ */ lazySchema(() =>
	z
		.object({
			id: z.string().uuid(),
			gen: z.coerce.number().int().min(0),
			before: EventKeySchema.optional(),
			after: EventKeySchema.optional(),
			around: EventKeySchema.optional(),
			/** One turn whole, by its boundary key: an unfolded turn's work. */
			turn: EventKeySchema.optional(),
			fold: QueryFlagSchema,
		})
		.refine(
			(v) =>
				[v.before, v.after, v.around, v.turn].filter((x) => x !== undefined)
					.length <= 1,
			"Pass at most one of before, after, around and turn",
		),
);
export type ThreadPageInput = z.infer<typeof ThreadPageInputSchema>;

export const ThreadIndexInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ id: z.string().uuid() }),
);

export const EventFullInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		gen: z.coerce.number().int().min(0),
		key: EventKeySchema,
	}),
);
export const EventFullSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		event: CanonicalEventSchema,
	}),
);

export const SearchEventsInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		id: z.string().uuid(),
		q: z.string().min(1).max(FIND_QUERY_MAX),
		caseSensitive: QueryFlagSchema,
		scope: z.enum(FIND_SCOPES).default("all"),
		/** Count only what was committed up to here, so paging never chases new events. */
		revision: z.coerce.number().int().min(0).optional(),
		/** Hits to skip: the next page of a long result. */
		from: z.coerce.number().int().min(0).default(0),
	}),
);
export type SearchEventsInput = z.infer<typeof SearchEventsInputSchema>;

/** Hits returned per search page. */
export const SEARCH_PAGE_HITS = 1000;

export const SearchEventsSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		revision: z.number().int(),
		/** Occurrences across the whole thread. */
		total: z.number().int(),
		/** Items with a hit, across the whole thread. */
		items: z.number().int(),
		/** `[key, occurrences]` in display order, from `from`. */
		hits: z.array(z.tuple([z.string(), z.number().int().positive()])),
		/** The `from` of the next page; null when this one ends the result. */
		next: z.number().int().nullable(),
	}),
);
export type SearchEvents = z.infer<typeof SearchEventsSchema>;

export const SearchMessagesInputSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		q: z.string().min(1).max(FIND_QUERY_MAX),
		caseSensitive: QueryFlagSchema,
		/** The `next` of the previous answer: where the walk over threads goes on. */
		cursor: z.string().max(200).optional(),
		limit: z.coerce.number().int().min(1).max(50).default(20),
	}),
);
export type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;

export const SearchMessagesSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		hits: z.array(
			z.object({
				threadId: z.string(),
				title: z.string().nullable(),
				key: z.string(),
				/** The matched text around the first occurrence. */
				snippet: z.string(),
				count: z.number().int().positive(),
			}),
		),
		/** Threads read so far, and how many exist. */
		searched: z.number().int(),
		total: z.number().int(),
		next: z.string().nullable(),
	}),
);
export type SearchMessages = z.infer<typeof SearchMessagesSchema>;

// ---- stream frames ----

/** Frame names the resumable stream writes; the data of each is JSON. */
export const STREAM_FRAMES = [
	"live",
	"commit",
	"reset",
	"resync",
	"done",
] as const;

export const LiveFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		event: CanonicalEventSchema,
	}),
);
export const CommitFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		/** Every committed event up to this ordinal has now been sent. */
		through: z.number().int(),
		/** Committed events this subscriber had not been sent live. */
		events: z.array(
			z.object({ ordinal: z.number().int(), event: CanonicalEventSchema }),
		),
		/** `[key, ordinal]` of every event this commit made durable, the ones sent live included. */
		acks: z.array(z.tuple([z.string(), z.number().int()])),
	}),
);
export const DoneFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({
		gen: z.number().int(),
		/** Every committed event up to here was sent; a provisional key never acked was not saved. */
		through: z.number().int(),
		/** Events a run could not store this generation: the record is incomplete when above 0. */
		lost: z.number().int().nonnegative(),
	}),
);
export const ResetFrameSchema = /* @__PURE__ */ lazySchema(() =>
	z.object({ gen: z.number().int() }),
);
export type LiveFrame = z.infer<typeof LiveFrameSchema>;
export type CommitFrame = z.infer<typeof CommitFrameSchema>;
export type DoneFrame = z.infer<typeof DoneFrameSchema>;
