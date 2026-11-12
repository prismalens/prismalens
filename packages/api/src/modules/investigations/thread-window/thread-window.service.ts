// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { setImmediate as yieldToLoop } from "node:timers/promises";
import { Injectable, Logger } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	type CanonicalEvent,
	CanonicalEventSchema,
	type FoldedTurn,
	type OpenThread,
	type OpenThreadInput,
	type PageItem,
	recordedFindings,
	type ThreadIndex,
	type ThreadPage,
	type ThreadPageInput,
	type ThreadState,
} from "@prismalens/contracts";
import { PrismaService } from "../../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../../shared/utils/json-utils.js";
import { AsksService } from "../../asks/asks.service.js";
import { cutForPage } from "./cut.js";
import {
	buildProjection,
	type LightEntry,
	lightEntry,
	openerIds,
	type Projection,
} from "./projection.js";

/** Rows each read examines: bounds a scan's memory and its time between yields. */
export const SCAN_ROWS = 500;
/** A page's budget (#1101 cat 12): whole turns while they fit, never past these. */
export const PAGE_TURNS = 12;
export const PAGE_EVENTS = 250;
export const PAGE_BYTES = 192 * 1024;
/** Light bytes one event is counted at before its page is cut and measured. */
const EST_EVENT_BYTES = 6 * 1024;
const CACHED_THREADS = 8;

/** Kinds the thread-wide state reads: asks, their lifecycle, the queue and findings. */
const STATE_KINDS = new Set([
	"ask_opened",
	"ask_closed",
	"permission_ask",
	"permission_answer",
	"branch_done",
	"error",
	"report",
	"operator_message",
	"message_queued",
	"message_edited",
	"message_withdrawn",
	"finding_recorded",
]);

/** Answers a named position, e.g. `unread`, with the item a thread opens at (#1101 cat 3). */
export type PositionResolver = (
	threadId: string,
	projection: Projection,
) => Promise<string | null>;

interface Cached {
	projection: Projection;
	light: LightEntry[];
	openers: Map<string, string>;
}

export class StaleGeneration extends ORPCError<"CONFLICT", { gen: number }> {
	constructor(gen: number) {
		super("CONFLICT", {
			message: "STALE_GENERATION: the thread's record was replaced; reopen it",
			data: { gen },
		});
	}
}

/**
 * A long thread read in windows (#1101 categories 12-14): a light projection of its
 * record, cached by `(generation, revision)` and extended by the rows past its
 * revision, serves pages, the rail's index and the thread-wide state.
 */
@Injectable()
export class ThreadWindowService {
	private readonly logger = new Logger(ThreadWindowService.name);
	private readonly cache = new Map<string, Cached>();
	private readonly resolvers = new Map<string, PositionResolver>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly asks: AsksService,
	) {}

	/** Register what a named position means; the unread mark is one (#1101 cat 3). */
	registerPosition(name: string, resolve: PositionResolver): void {
		this.resolvers.set(name, resolve);
	}

	/** Where the record stands: its generation, last committed ordinal and lost count. */
	async head(
		threadId: string,
	): Promise<{ gen: number; revision: number; lost: number; status: string }> {
		const row = await this.prisma.investigation.findUnique({
			where: { id: threadId },
			select: {
				eventGeneration: true,
				eventOrdinal: true,
				eventsLost: true,
				status: true,
			},
		});
		if (!row)
			throw new ORPCError("NOT_FOUND", {
				message: `Thread ${threadId} not found`,
			});
		return {
			gen: row.eventGeneration,
			revision: row.eventOrdinal,
			lost: row.eventsLost,
			status: row.status,
		};
	}

	/** Parse a stored row; a corrupt one is dropped and logged, as the replay does. */
	parseRow(threadId: string, raw: string): CanonicalEvent | null {
		const obj = safeParseJsonObject(raw);
		const parsed = obj ? CanonicalEventSchema.safeParse(obj) : null;
		if (parsed?.success) return parsed.data;
		this.logger.warn(`Dropped a corrupt stored event of thread ${threadId}`);
		return null;
	}

	/**
	 * Parse a stored row for a scan that only reads a few fields: JSON alone, since a
	 * schema parse of every row triples a cold scan (#1101 cat 13). Pages still parse in full.
	 */
	lightRow(raw: string): CanonicalEvent | null {
		const obj = safeParseJsonObject(raw) as { kind?: unknown } | null;
		return obj && typeof obj.kind === "string"
			? (obj as unknown as CanonicalEvent)
			: null;
	}

	/** Committed rows with `after < ordinal ≤ through`, read in bounded ranges. */
	async *rows(
		threadId: string,
		after: number,
		through: number,
		signal?: AbortSignal,
	): AsyncGenerator<
		{ seq: number; branchId: string; ordinal: number; event: string }[]
	> {
		for (let lo = after; lo < through; lo += SCAN_ROWS) {
			if (signal?.aborted) throw new ORPCError("CLIENT_CLOSED_REQUEST");
			const rows = await this.prisma.investigationEvent.findMany({
				where: {
					investigationId: threadId,
					ordinal: { gt: lo, lte: Math.min(lo + SCAN_ROWS, through) },
				},
				select: { seq: true, branchId: true, ordinal: true, event: true },
				orderBy: { ordinal: "asc" },
			});
			yield rows;
			await yieldToLoop();
		}
	}

	/** The thread's projection at its current revision, extending a cached one when it can. */
	async projection(
		threadId: string,
		signal?: AbortSignal,
	): Promise<Projection> {
		const head = await this.head(threadId);
		const hit = this.cache.get(threadId);
		if (
			hit &&
			hit.projection.gen === head.gen &&
			hit.projection.revision === head.revision &&
			hit.projection.lost === head.lost
		) {
			this.touch(threadId, hit);
			return hit.projection;
		}
		const reuse = hit && hit.projection.gen === head.gen;
		const light = reuse ? [...hit.light] : [];
		const openers = reuse ? new Map(hit.openers) : new Map<string, string>();
		const from = reuse ? hit.projection.revision : 0;
		const seen = new Set(light.map((e) => e.key));
		for await (const rows of this.rows(threadId, from, head.revision, signal))
			for (const row of rows) {
				const event = this.lightRow(row.event);
				if (!event) continue;
				let entry: LightEntry;
				try {
					entry = lightEntry({ ...row, bytes: row.event.length }, event);
				} catch {
					this.logger.warn(
						`Skipped a malformed stored event of thread ${threadId}`,
					);
					continue;
				}
				if (seen.has(entry.key)) continue;
				seen.add(entry.key);
				light.push(entry);
				for (const id of openerIds(event))
					if (!openers.has(id)) openers.set(id, entry.key);
			}
		const after = await this.head(threadId);
		if (after.gen !== head.gen) throw new StaleGeneration(after.gen);
		const projection = buildProjection(
			head.gen,
			head.revision,
			head.lost,
			light,
			openers,
		);
		this.touch(threadId, { projection, light, openers });
		return projection;
	}

	private touch(threadId: string, entry: Cached): void {
		this.cache.delete(threadId);
		this.cache.set(threadId, entry);
		while (this.cache.size > CACHED_THREADS) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			this.cache.delete(oldest);
		}
	}

	/** Forget a thread's projection: its record was cleared for a rerun. */
	forget(threadId: string): void {
		this.cache.delete(threadId);
	}

	index(p: Projection): ThreadIndex {
		return {
			gen: p.gen,
			revision: p.revision,
			total: p.entries.length,
			lost: p.lost,
			turns: p.turns.map((t) => t.summary),
			entries: p.entries.flatMap((e) => (e.entry ? [e.entry] : [])),
		};
	}

	async readIndex(threadId: string): Promise<ThreadIndex> {
		return this.index(await this.projection(threadId));
	}

	async open(input: OpenThreadInput): Promise<OpenThread> {
		const p = await this.projection(input.id);
		let landing: string | null = null;
		const at =
			input.at && /^\d+$/.test(input.at)
				? p.entries.find((e) => e.seq === Number(input.at))?.key
				: input.at;
		if (at && p.at.has(at)) landing = at;
		else if (input.position) {
			const resolve = this.resolvers.get(input.position);
			const key = resolve ? await resolve(input.id, p) : null;
			if (key && p.at.has(key)) landing = key;
		}
		const page = await this.page(input.id, p, {
			...(landing ? { around: landing } : {}),
			fold: input.fold,
		});
		const state = await this.state(input.id, p);
		return {
			gen: p.gen,
			revision: p.revision,
			index: this.index(p),
			page,
			state,
			landing,
		};
	}

	async readPage(input: ThreadPageInput): Promise<ThreadPage> {
		const p = await this.projection(input.id);
		if (p.gen !== input.gen) throw new StaleGeneration(p.gen);
		return this.page(input.id, p, input);
	}

	/** Pick the page's display range under the budget, preferring whole turns. */
	range(
		p: Projection,
		opts: { before?: string; after?: string; around?: string; turn?: string },
	): [number, number] | null {
		const n = p.entries.length;
		if (n === 0) return null;
		const est = (i: number) =>
			Math.min((p.entries[i] as LightEntry).bytes, EST_EVENT_BYTES);
		const turnStart = (i: number) =>
			(p.turns[p.turnOf[i] as number] as { start: number }).start;
		const turnEnd = (i: number) =>
			(p.turns[p.turnOf[i] as number] as { end: number }).end;

		const fits = (count: number, bytes: number, turns: Set<number>) =>
			count <= PAGE_EVENTS && bytes <= PAGE_BYTES && turns.size <= PAGE_TURNS;

		const walk = (
			from: number,
			step: 1 | -1,
			stop: number,
		): [number, number] | null => {
			if (step === -1 ? from < stop : from > stop) return null;
			let count = 0;
			let bytes = 0;
			const turns = new Set<number>();
			let i = from;
			let last = from;
			for (; step === -1 ? i >= stop : i <= stop; i += step) {
				turns.add(p.turnOf[i] as number);
				if (count > 0 && !fits(count + 1, bytes + est(i), turns)) break;
				count++;
				bytes += est(i);
				last = i;
			}
			let lo = Math.min(from, last);
			let hi = Math.max(from, last);
			if (step === -1 && lo > turnStart(lo) && lo > stop) {
				// Cut mid-turn: start at the next whole turn when one is left in range.
				const next = turnEnd(lo);
				if (next <= hi) lo = next;
			}
			if (step === 1 && hi < turnEnd(hi) - 1 && hi < stop) {
				const start = turnStart(hi);
				if (start > lo) hi = start - 1;
			}
			return [lo, hi];
		};

		if (opts.turn !== undefined) {
			const i = p.at.get(opts.turn);
			if (i === undefined) return null;
			return walk(turnStart(i), 1, turnEnd(i) - 1);
		}
		if (opts.before !== undefined) {
			const i = p.at.get(opts.before);
			if (i === undefined) return null;
			return walk(i - 1, -1, 0);
		}
		if (opts.after !== undefined) {
			const i = p.at.get(opts.after);
			if (i === undefined) return null;
			return walk(i + 1, 1, n - 1);
		}
		if (opts.around !== undefined) {
			const i = p.at.get(opts.around);
			if (i === undefined) return null;
			// The target's turn, then neighbours alternately while the budget holds.
			let lo = turnStart(i);
			let hi = turnEnd(i) - 1;
			let count = 0;
			let bytes = 0;
			for (let j = lo; j <= hi; j++) {
				count++;
				bytes += est(j);
			}
			if (count > PAGE_EVENTS || bytes > PAGE_BYTES) {
				// One turn over the budget: a window inside it, centred on the target.
				lo = i;
				hi = i;
				count = 1;
				bytes = est(i);
				let grew = true;
				while (grew) {
					grew = false;
					for (const j of [hi + 1, lo - 1]) {
						if (j < turnStart(i) || j >= turnEnd(i)) continue;
						if (!fits(count + 1, bytes + est(j), new Set())) continue;
						count++;
						bytes += est(j);
						if (j > hi) hi = j;
						else lo = j;
						grew = true;
					}
				}
				return [lo, hi];
			}
			const turns = new Set([p.turnOf[i] as number]);
			let grew = true;
			while (grew) {
				grew = false;
				for (const side of [-1, 1] as const) {
					const t = (p.turnOf[side === -1 ? lo : hi] as number) + side;
					const turn = p.turns[t];
					if (!turn) continue;
					let c = 0;
					let b = 0;
					for (let j = turn.start; j < turn.end; j++) {
						c++;
						b += est(j);
					}
					const next = new Set(turns).add(t);
					if (!fits(count + c, bytes + b, next)) continue;
					turns.add(t);
					count += c;
					bytes += b;
					if (side === -1) lo = turn.start;
					else hi = turn.end - 1;
					grew = true;
				}
			}
			return [lo, hi];
		}
		return walk(n - 1, -1, 0);
	}

	/** The indexes a range ships: events anchored inside it, wherever they sit. */
	members(p: Projection, lo: number, hi: number): number[] {
		const out = new Set<number>();
		for (let i = lo; i <= hi; i++) {
			const a = p.anchorAt[i] as number;
			if (a >= lo && a <= hi) out.add(i);
			for (const d of p.dependents.get(i) ?? []) out.add(d);
		}
		return [...out].sort((a, b) => a - b);
	}

	/** Finished turns inside the range ship without their work (bar 12.5). */
	private folds(
		p: Projection,
		lo: number,
		hi: number,
		target: number | null,
	): { hide: Set<number>; folded: FoldedTurn[] } {
		const hide = new Set<number>();
		const folded: FoldedTurn[] = [];
		const lastTurn = p.turns.length - 1;
		for (let t = p.turnOf[lo] as number; t <= (p.turnOf[hi] as number); t++) {
			const turn = p.turns[t];
			if (!turn || t === lastTurn) continue;
			if (turn.start < lo || turn.end - 1 > hi) continue;
			if (target !== null && target >= turn.start && target < turn.end)
				continue;
			if (turn.summary.steps === 0) continue;
			let answer = -1;
			for (let i = turn.end - 1; i > turn.start; i--)
				if ((p.entries[i] as LightEntry).prose) {
					answer = i;
					break;
				}
			let hidden = 0;
			for (let i = turn.start + 1; i < turn.end; i++) {
				const e = p.entries[i] as LightEntry;
				const a = p.anchorAt[i] as number;
				if (i === answer || a === answer || !e.work) continue;
				hide.add(i);
				hidden++;
			}
			if (hidden > 0)
				folded.push({
					turnKey: turn.summary.key,
					steps: turn.summary.steps,
					failed: turn.summary.failed,
					seconds: turn.summary.seconds,
					hidden,
				});
		}
		return { hide, folded };
	}

	async page(
		threadId: string,
		p: Projection,
		opts: {
			before?: string;
			after?: string;
			around?: string;
			turn?: string;
			fold?: boolean;
		},
	): Promise<ThreadPage> {
		const empty = (): ThreadPage => ({
			gen: p.gen,
			revision: p.revision,
			lo: null,
			hi: null,
			hasBefore: false,
			hasAfter: false,
			items: [],
			context: {
				stepsBefore: 0,
				endsBefore: 0,
				operatorsBefore: 0,
				agentBefore: false,
			},
			folded: [],
			target: opts.around ?? null,
		});
		const picked = this.range(p, opts);
		if (!picked) return empty();
		let [lo, hi] = picked;
		const target = opts.around ? (p.at.get(opts.around) ?? null) : null;
		const fromEnd =
			opts.before !== undefined || (!opts.after && !opts.around && !opts.turn);

		for (;;) {
			const { hide, folded } =
				opts.fold && !opts.turn
					? this.folds(p, lo, hi, target)
					: { hide: new Set<number>(), folded: [] };
			const members = this.members(p, lo, hi).filter((i) => !hide.has(i));
			const items = await this.items(threadId, p, members);
			const bytes = JSON.stringify(items).length;
			// Measured, not estimated: shrink from the far side until the page fits.
			if (bytes > PAGE_BYTES && hi > lo) {
				const keep = target ?? (fromEnd ? hi : lo);
				const span = hi - lo + 1;
				const cut = Math.max(1, Math.floor(span / 4));
				if (fromEnd) lo = Math.min(lo + cut, keep);
				else if (target !== null) {
					if (target - lo > hi - target) lo = Math.min(lo + cut, keep);
					else hi = Math.max(hi - cut, keep);
				} else hi = Math.max(hi - cut, keep);
				continue;
			}
			return {
				gen: p.gen,
				revision: p.revision,
				lo: (p.entries[lo] as LightEntry).key,
				hi: (p.entries[hi] as LightEntry).key,
				hasBefore: lo > 0,
				hasAfter: hi < p.entries.length - 1,
				items,
				context: {
					stepsBefore: p.stepsBefore[lo] as number,
					endsBefore: p.endsBefore[lo] as number,
					operatorsBefore: p.operatorsBefore[lo] as number,
					agentBefore: (p.proseBefore[lo] as number) > 0,
				},
				folded,
				target: opts.around ?? null,
			};
		}
	}

	/** Read and cut the events at these entry indexes, in display order. */
	async items(
		threadId: string,
		p: Projection,
		indexes: number[],
	): Promise<PageItem[]> {
		if (indexes.length === 0) return [];
		const ordinals = indexes.map((i) => (p.entries[i] as LightEntry).ordinal);
		const rows = await this.prisma.investigationEvent.findMany({
			where: { investigationId: threadId, ordinal: { in: ordinals } },
			select: { ordinal: true, event: true },
		});
		const byOrdinal = new Map(rows.map((r) => [r.ordinal, r.event]));
		const out: PageItem[] = [];
		for (const i of indexes) {
			const e = p.entries[i] as LightEntry;
			const raw = byOrdinal.get(e.ordinal);
			const event = raw ? this.parseRow(threadId, raw) : null;
			if (!event) continue;
			const cut = cutForPage(event);
			out.push({
				key: e.key,
				ordinal: e.ordinal,
				event: cut.event,
				...(cut.cut ? { cut: cut.cut } : {}),
			});
		}
		return out;
	}

	async eventFull(
		threadId: string,
		gen: number,
		key: string,
	): Promise<{ gen: number; event: CanonicalEvent }> {
		const p = await this.projection(threadId);
		if (p.gen !== gen) throw new StaleGeneration(p.gen);
		const i = p.at.get(key);
		const e = i === undefined ? undefined : p.entries[i];
		const row = e
			? await this.prisma.investigationEvent.findFirst({
					where: { investigationId: threadId, ordinal: e.ordinal },
					select: { event: true },
				})
			: null;
		const event = row ? this.parseRow(threadId, row.event) : null;
		if (!event)
			throw new ORPCError("NOT_FOUND", { message: `No event ${key}` });
		return { gen: p.gen, event };
	}

	/** Thread-wide state from the whole record's state kinds, never from a window (#1101 cat 12). */
	async state(threadId: string, p: Projection): Promise<ThreadState> {
		const indexes: number[] = [];
		p.entries.forEach((e, i) => {
			if (STATE_KINDS.has(e.kind)) indexes.push(i);
		});
		const ordinals = indexes.map((i) => (p.entries[i] as LightEntry).ordinal);
		const events: CanonicalEvent[] = [];
		for (let k = 0; k < ordinals.length; k += SCAN_ROWS) {
			const rows = await this.prisma.investigationEvent.findMany({
				where: {
					investigationId: threadId,
					ordinal: { in: ordinals.slice(k, k + SCAN_ROWS) },
				},
				select: { ordinal: true, event: true },
			});
			const by = new Map(rows.map((r) => [r.ordinal, r.event]));
			for (const o of ordinals.slice(k, k + SCAN_ROWS)) {
				const raw = by.get(o);
				const e = raw ? this.parseRow(threadId, raw) : null;
				if (e) events.push(e);
			}
		}
		return stateOf(threadId, events, await this.asks.pending(threadId, events));
	}
}

/** Open asks, the queue and the hypotheses, from the state kinds in display order. */
export function stateOf(
	threadId: string,
	events: readonly CanonicalEvent[],
	pending: ThreadState["openAsks"],
): ThreadState {
	// A run-owned ask whose turn ended unanswered is not waiting any more (deriveAsks' rule).
	const ended = new Set<string>();
	const open = new Set<string>();
	for (const e of events) {
		if (
			e.kind === "error" ||
			e.kind === "report" ||
			e.kind === "branch_done" ||
			(e.kind === "operator_message" && e.resumed)
		) {
			for (const id of open) ended.add(id);
			open.clear();
		} else if (e.kind === "permission_ask") open.add(e.askId);
		else if (e.kind === "permission_answer") open.delete(e.askId);
	}
	const openAsks = pending.filter(
		(a) => a.source.kind === "tool" || !ended.has(a.askId),
	);
	const queue = new Map<
		string,
		{ messageId: string; text: string; at: string }
	>();
	for (const e of events) {
		if (e.kind === "message_queued") {
			for (const id of e.delivers ?? []) queue.delete(id);
			queue.set(e.messageId, {
				messageId: e.messageId,
				text: e.text,
				at: e.ts,
			});
		} else if (e.kind === "message_edited") {
			const q = queue.get(e.messageId);
			if (q) queue.set(e.messageId, { ...q, text: e.text });
		} else if (e.kind === "message_withdrawn") queue.delete(e.messageId);
		else if (e.kind === "operator_message" && e.messageId) {
			queue.delete(e.messageId);
			for (const id of e.delivers ?? []) queue.delete(id);
		}
	}
	return {
		openAsks,
		queue: [...queue.values()],
		hypotheses: recordedFindings(events).hypotheses,
	};
}
