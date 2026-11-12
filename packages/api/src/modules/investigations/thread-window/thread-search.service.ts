// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { setImmediate as yieldToLoop } from "node:timers/promises";
import { Injectable } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import {
	comparePosition,
	countOccurrences,
	findOccurrences,
	rowKey,
	SEARCH_PAGE_HITS,
	type SearchEvents,
	type SearchEventsInput,
	type SearchMessages,
	type SearchMessagesInput,
	searchableText,
} from "@prismalens/contracts";
import { Prisma } from "@prismalens/database";
import { PrismaService } from "../../../core/prisma/prisma.service.js";
import { SCAN_ROWS, ThreadWindowService } from "./thread-window.service.js";

/** How long one cross-thread answer may read before it hands back a `next` (#1101 cat 13). */
export const CROSS_THREAD_BUDGET_MS = 400;
const THREAD_BATCH = 25;
const CACHED_RESULTS = 32;

/** Non-ASCII characters whose JS lowercase holds an ASCII letter: SQLite's lower() misses them. */
const ASCII_FOLD_PREIMAGES: Record<string, string> = { i: "İ", k: "K" };

/**
 * A SQL condition every row holding a match passes, or null when none is provably a
 * superset. JSON escapes quotes, backslashes and control characters, so a query
 * holding one may match text whose stored form differs; those scan every row.
 */
export function prefilter(
	q: string,
	caseSensitive: boolean,
): Prisma.Sql | null {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what JSON escapes.
	if (/["\\\u0000-\u001f]/.test(q)) return null;
	if (caseSensitive) return Prisma.sql`AND instr(event, ${q}) > 0`;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII is the whole range lower() folds.
	if (!/^[\u0000-\u007f]+$/.test(q)) return null;
	const low = q.toLowerCase();
	const extra = Object.entries(ASCII_FOLD_PREIMAGES)
		.filter(([letter]) => low.includes(letter))
		.map(([, ch]) => Prisma.sql` OR instr(event, ${ch}) > 0`);
	const or = extra.length ? Prisma.join(extra, "") : Prisma.empty;
	return Prisma.sql`AND (instr(lower(event), ${low}) > 0${or})`;
}

interface Row {
	seq: number | bigint;
	branchId: string;
	ordinal: number | bigint;
	event: string;
}

interface Hit {
	key: string;
	seq: number;
	branchId: string;
	count: number;
}

@Injectable()
export class ThreadSearchService {
	private readonly results = new Map<string, { total: number; hits: Hit[] }>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly window: ThreadWindowService,
	) {}

	private async scan(
		threadId: string,
		lo: number,
		hi: number,
		filter: Prisma.Sql | null,
	): Promise<Row[]> {
		return this.prisma.$queryRaw<Row[]>`
			SELECT seq, "branchId", ordinal, event FROM investigation_events
			WHERE "investigationId" = ${threadId} AND ordinal > ${lo} AND ordinal <= ${hi}
			${filter ?? Prisma.empty}
			ORDER BY ordinal`;
	}

	/** Every hit in one thread, counted on the server over the record up to `revision`. */
	async search(
		input: SearchEventsInput,
		signal?: AbortSignal,
	): Promise<SearchEvents> {
		const head = await this.window.head(input.id);
		const revision = Math.min(input.revision ?? head.revision, head.revision);
		const caseSensitive = !!input.caseSensitive;
		const cacheKey = JSON.stringify([
			input.id,
			head.gen,
			revision,
			input.q,
			caseSensitive,
			input.scope,
		]);
		let found = this.results.get(cacheKey);
		if (!found) {
			const filter = prefilter(input.q, caseSensitive);
			const hits: Hit[] = [];
			let total = 0;
			for (let lo = 0; lo < revision; lo += SCAN_ROWS) {
				if (signal?.aborted) throw new ORPCError("CLIENT_CLOSED_REQUEST");
				const rows = await this.scan(
					input.id,
					lo,
					Math.min(lo + SCAN_ROWS, revision),
					filter,
				);
				for (const row of rows) {
					const event = this.window.lightRow(row.event);
					if (!event) continue;
					let count = 0;
					try {
						count = countOccurrences(
							searchableText(event, input.scope),
							input.q,
							{ caseSensitive },
						);
					} catch {
						continue;
					}
					if (count === 0) continue;
					const seq = Number(row.seq);
					hits.push({
						key: rowKey(row.branchId, seq),
						seq,
						branchId: row.branchId,
						count,
					});
					total += count;
				}
				await yieldToLoop();
			}
			const after = await this.window.head(input.id);
			if (after.gen !== head.gen)
				throw new ORPCError("CONFLICT", {
					message: "STALE_GENERATION: the thread's record was replaced",
					data: { gen: after.gen },
				});
			hits.sort(comparePosition);
			found = { total, hits };
			this.results.set(cacheKey, found);
			while (this.results.size > CACHED_RESULTS) {
				const oldest = this.results.keys().next().value;
				if (oldest === undefined) break;
				this.results.delete(oldest);
			}
		}
		const end = input.from + SEARCH_PAGE_HITS;
		return {
			gen: head.gen,
			revision,
			total: found.total,
			items: found.hits.length,
			hits: found.hits
				.slice(input.from, end)
				.map((h) => [h.key, h.count] as [string, number]),
			next: end < found.hits.length ? end : null,
		};
	}

	/**
	 * Message text across threads, newest activity first. Each answer reads for at most
	 * {@link CROSS_THREAD_BUDGET_MS} and hands back `next`, so older threads stay findable.
	 */
	async searchMessages(input: SearchMessagesInput): Promise<SearchMessages> {
		const started = Date.now();
		const caseSensitive = !!input.caseSensitive;
		const filter = prefilter(input.q, caseSensitive);
		const total = await this.prisma.investigation.count();
		let offset = Number(input.cursor ?? 0) || 0;
		const hits: SearchMessages["hits"] = [];
		let searched = offset;
		while (hits.length < input.limit) {
			const threads = await this.prisma.$queryRaw<
				{ id: string; title: string | null }[]
			>`
				SELECT id, title FROM investigations
				ORDER BY COALESCE("lastActivityAt", "createdAt") DESC, id
				LIMIT ${THREAD_BATCH} OFFSET ${offset}`;
			if (threads.length === 0) {
				offset = -1;
				break;
			}
			for (const t of threads) {
				offset++;
				searched++;
				const hit = await this.firstHit(t.id, input.q, caseSensitive, filter);
				if (hit) hits.push({ threadId: t.id, title: t.title, ...hit });
				if (hits.length >= input.limit) break;
				if (Date.now() - started > CROSS_THREAD_BUDGET_MS) break;
			}
			if (Date.now() - started > CROSS_THREAD_BUDGET_MS) break;
		}
		return {
			hits,
			searched,
			total,
			next: offset < 0 || offset >= total ? null : String(offset),
		};
	}

	private async firstHit(
		threadId: string,
		q: string,
		caseSensitive: boolean,
		filter: Prisma.Sql | null,
	): Promise<{ key: string; snippet: string; count: number } | null> {
		const head = await this.window.head(threadId);
		let first: { key: string; snippet: string; pos: Hit } | null = null;
		let count = 0;
		for (let lo = 0; lo < head.revision; lo += SCAN_ROWS) {
			const rows = await this.scan(
				threadId,
				lo,
				Math.min(lo + SCAN_ROWS, head.revision),
				filter,
			);
			for (const row of rows) {
				const event = this.window.lightRow(row.event);
				if (!event) continue;
				let texts: string[];
				try {
					texts = [
						...searchableText(event, "mine"),
						...searchableText(event, "agent"),
					];
				} catch {
					continue;
				}
				for (const text of texts) {
					const found = findOccurrences(text, q, { caseSensitive });
					if (found.length === 0) continue;
					count += found.length;
					const seq = Number(row.seq);
					const pos = {
						key: rowKey(row.branchId, seq),
						seq,
						branchId: row.branchId,
						count: 0,
					};
					if (!first || comparePosition(pos, first.pos) < 0) {
						const [s, e] = found[0] as [number, number];
						const from = Math.max(0, s - 40);
						first = {
							key: pos.key,
							pos,
							snippet: `${from > 0 ? "…" : ""}${text.slice(from, e + 40).replace(/\s+/g, " ")}${e + 40 < text.length ? "…" : ""}`,
						};
					}
				}
			}
			await yieldToLoop();
		}
		return first ? { key: first.key, snippet: first.snippet, count } : null;
	}
}
