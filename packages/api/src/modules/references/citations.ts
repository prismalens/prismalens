// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	CanonicalEventSchema,
	CITATION_EXCERPT_CHARS,
	type Citation,
	messageRefId,
	parseEventKey,
	parseMessageRefId,
	type Quote,
	type ReferenceKind,
	type ReferenceRef,
	type ReferenceSnapshot,
	rowKey,
	type ThreadCitations,
} from "@prismalens/contracts";
import { fenceUntrusted, sanitizeUntrustedBlock } from "@prismalens/engine";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { threadLink } from "../thread-tree/tree-text.js";
import type {
	ReferenceCandidate,
	ReferenceContext,
	ReferenceProvider,
} from "./reference-provider.js";

/** A message cited from another thread, as `compose` and `pl_citation_read` name it. */
export interface CitedMessage {
	threadId: string;
	key: string;
	turn: number;
	title: string | null;
	text: string;
}

/** What `pl_citation_read` returns for one cited message's turn. */
export interface CitedTurn {
	threadId: string;
	key: string;
	turn: number;
	link: string;
	/** The turn as text, fenced: every line in it is the other thread's, data only. */
	body: string;
}

const TURN_ROWS = 400;
const REPLY_CHARS = 2000;
const CALL_CHARS = 300;
const EDIT_CHARS = 1500;
const PATH_KEYS = ["path", "file_path", "filePath", "notebook_path"] as const;
const EDIT_KEYS = ["patch", "diff", "new_string", "content", "edits"] as const;
const OP = '"kind":"operator_message"';

const cut = (s: string, n: number) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** The cited message goes whole: the excerpt sent with it points here for the rest. */
const reply = (text: string, mark: string) =>
	mark ? text : cut(text, REPLY_CHARS);

function parse(raw: string): CanonicalEvent | null {
	try {
		const p = CanonicalEventSchema.safeParse(JSON.parse(raw));
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}

function isOperatorMessage(raw: string): boolean {
	try {
		return JSON.parse(raw)?.kind === "operator_message";
	} catch {
		return false;
	}
}

/** The words a message carries: the user's or the agent's. */
function messageText(e: CanonicalEvent | null): string | null {
	if (e?.kind === "agent_step" || e?.kind === "operator_message")
		return e.text.trim() || null;
	return null;
}

/**
 * Where a cited message's text reaches the receiving agent: inside a fence (#1195). It is cut
 * short only when `pl_citation_read` can return the rest; a quote with no readable message goes whole.
 */
export function citationBlock(
	c: { threadId: string; key?: string; turn?: number },
	text: string,
): string {
	const readable = Boolean(c.key && c.turn);
	const body = sanitizeUntrustedBlock(
		readable && text.length > CITATION_EXCERPT_CHARS
			? `${text.slice(0, CITATION_EXCERPT_CHARS)}\n(cut here; pl_citation_read has the rest)`
			: text,
	);
	return [
		readable
			? `Cited from thread ${c.threadId}, message ${c.key}, turn ${c.turn}. For that turn's tool calls, edits, files and pull requests, call pl_citation_read with threadId "${c.threadId}" and key "${c.key}".`
			: `Cited from thread ${c.threadId}.`,
		fenceUntrusted(
			"CITED_MESSAGE",
			"Text the user cited from another PrismaLens thread; that thread's agent or tools may have written it.",
			body,
			"answer",
		),
	].join("\n");
}

/**
 * Messages cited across threads (#1195): the turn each sits in, the rows that link the
 * two threads both ways, and the turn `pl_citation_read` expands.
 */
export class Citations {
	constructor(private readonly prisma: PrismaService) {}

	/** The cited message, or null when the thread or the event is gone or carries no words. */
	async message(threadId: string, key: string): Promise<CitedMessage | null> {
		const at = parseEventKey(key);
		if (!at) return null;
		const [thread, row] = await Promise.all([
			this.prisma.investigation.findUnique({
				where: { id: threadId },
				select: { title: true },
			}),
			this.prisma.investigationEvent.findUnique({
				where: {
					investigationId_branchId_seq: {
						investigationId: threadId,
						branchId: at.branchId,
						seq: at.seq,
					},
				},
				select: { event: true, ordinal: true },
			}),
		]);
		if (!thread || !row) return null;
		const text = messageText(parse(row.event));
		if (!text) return null;
		const { turn } = await this.span(threadId, row.ordinal);
		return { threadId, key, turn, title: thread.title, text };
	}

	/**
	 * A turn starts at each message the user sent; a thread whose start wrote none counts
	 * its start as turn 1. `from` and `until` bound the turn's ordinals.
	 */
	private async span(
		threadId: string,
		ordinal: number,
	): Promise<{ turn: number; from: number; until: number | null }> {
		const [ops, firstAgent] = await Promise.all([
			this.prisma.investigationEvent.findMany({
				where: { investigationId: threadId, event: { contains: OP } },
				orderBy: { ordinal: "asc" },
				select: { ordinal: true, event: true },
			}),
			this.prisma.investigationEvent.findFirst({
				where: {
					investigationId: threadId,
					event: { contains: '"kind":"agent_step"' },
				},
				orderBy: { ordinal: "asc" },
				select: { ordinal: true },
			}),
		]);
		// OP also matches a tool call whose arguments carry that kind; only the event's own kind starts a turn.
		const starts = ops
			.filter((o) => isOperatorMessage(o.event))
			.map((o) => o.ordinal);
		const startWrote =
			starts.length > 0 &&
			(!firstAgent || (starts[0] as number) < firstAgent.ordinal);
		const before = starts.filter((o) => o <= ordinal);
		return {
			turn: before.length + (startWrote ? 0 : 1),
			from: before.at(-1) ?? 0,
			until: starts.find((o) => o > ordinal) ?? null,
		};
	}

	/** Each quote or `message` reference from another thread, kept as a row once (#1195). */
	async record(
		threadId: string,
		input: { quotes?: Quote[]; references?: ReferenceRef[] },
	): Promise<void> {
		const cited = new Map<string, { threadId: string; key: string }>();
		for (const q of input.quotes ?? [])
			if (q.source.threadId !== threadId && q.source.key)
				cited.set(`${q.source.threadId}/${q.source.key}`, {
					threadId: q.source.threadId,
					key: q.source.key,
				});
		for (const r of input.references ?? []) {
			const m = r.kind === "message" ? parseMessageRefId(r.id) : null;
			if (m && m.threadId !== threadId) cited.set(r.id, m);
		}
		for (const c of cited.values()) {
			const gen = await this.generation(c.threadId);
			const msg = await this.message(c.threadId, c.key);
			if (!msg || gen === null) continue;
			const where = {
				threadId,
				sourceThreadId: c.threadId,
				sourceKey: c.key,
			};
			await this.prisma.$transaction(async (tx) => {
				// A delete that matches no row (turns start at 1) takes SQLite's one write lock and changes
				// nothing, so no reset commits between the check and the write; a stale read writes nothing.
				await tx.messageCitation.deleteMany({
					where: { ...where, sourceTurn: -1 },
				});
				if ((await this.generation(c.threadId, tx)) !== gen) return;
				await tx.messageCitation.upsert({
					where: { threadId_sourceThreadId_sourceKey: where },
					create: { ...where, sourceTurn: msg.turn },
					update: {},
				});
			});
		}
	}

	/** The thread's reset count: a reset bumps it with the delete of its citations. */
	private async generation(
		threadId: string,
		db: Pick<PrismaService, "investigation"> = this.prisma,
	): Promise<number | null> {
		const t = await db.investigation.findUnique({
			where: { id: threadId },
			select: { eventGeneration: true },
		});
		return t?.eventGeneration ?? null;
	}

	/** A thread's citations both ways: what it cited, and where its own messages were cited. */
	async list(threadId: string): Promise<ThreadCitations> {
		const [cites, citedIn] = await Promise.all([
			this.prisma.messageCitation.findMany({
				where: { threadId },
				orderBy: { createdAt: "asc" },
				take: 200,
				include: { sourceThread: { select: { title: true } } },
			}),
			this.prisma.messageCitation.findMany({
				where: { sourceThreadId: threadId },
				orderBy: { createdAt: "asc" },
				take: 200,
				include: { thread: { select: { title: true } } },
			}),
		]);
		const row = (
			r: { sourceKey: string; sourceTurn: number; createdAt: Date },
			other: string,
			title: string | null,
		): Citation => ({
			threadId: other,
			title,
			key: r.sourceKey,
			turn: r.sourceTurn,
			at: r.createdAt.toISOString(),
		});
		return {
			cites: cites.map((r) => row(r, r.sourceThreadId, r.sourceThread.title)),
			citedIn: citedIn.map((r) => row(r, r.threadId, r.thread.title)),
		};
	}

	/** The cited message's turn, for a run whose thread cited it; null for any other. */
	async turn(
		runId: string,
		threadId: string,
		key: string,
	): Promise<CitedTurn | null> {
		const gen = await this.generation(threadId);
		const row = await this.prisma.messageCitation.findUnique({
			where: {
				threadId_sourceThreadId_sourceKey: {
					threadId: runId,
					sourceThreadId: threadId,
					sourceKey: key,
				},
			},
			select: { id: true },
		});
		const at = parseEventKey(key);
		if (!row || !at) return null;
		const [thread, cited] = await Promise.all([
			this.prisma.investigation.findUnique({
				where: { id: threadId },
				select: {
					id: true,
					title: true,
					status: true,
					incidentId: true,
					scheduleId: true,
					pullRequests: {
						select: {
							repo: true,
							number: true,
							url: true,
							state: true,
							title: true,
						},
					},
				},
			}),
			this.prisma.investigationEvent.findUnique({
				where: {
					investigationId_branchId_seq: {
						investigationId: threadId,
						branchId: at.branchId,
						seq: at.seq,
					},
				},
				select: { ordinal: true },
			}),
		]);
		if (!thread || !cited) return null;
		const span = await this.span(threadId, cited.ordinal);
		// A turn of up to TURN_ROWS reads whole; a longer one reads its opening half, then half from
		// the cited row (or straight on, when the opening holds it), and counts what it skips in place.
		const from = (gte: number, take: number) =>
			this.prisma.investigationEvent.findMany({
				where: {
					investigationId: threadId,
					ordinal: {
						gte,
						...(span.until !== null ? { lt: span.until } : {}),
					},
				},
				orderBy: { ordinal: "asc" },
				take,
				select: { event: true, branchId: true, seq: true, ordinal: true },
			});
		const opening = await from(span.from, TURN_ROWS + 1);
		const whole = opening.length <= TURN_ROWS;
		const head = whole ? opening : opening.slice(0, TURN_ROWS / 2);
		const headEnd = head.at(-1)?.ordinal ?? span.from - 1;
		const tail = whole
			? []
			: await from(Math.max(headEnd + 1, cited.ordinal), TURN_ROWS / 2);
		const tailEnd = tail.at(-1)?.ordinal ?? headEnd;
		const between = (gt: number, lt: number | null) =>
			this.prisma.investigationEvent.count({
				where: {
					investigationId: threadId,
					ordinal: { gt, ...(lt !== null ? { lt } : {}) },
				},
			});
		const [gap, rest] = whole
			? [0, 0]
			: await Promise.all([
					tail[0] ? between(headEnd, tail[0].ordinal) : 0,
					between(tailEnd, span.until),
				]);
		const rows = [...head, ...tail];
		const leftOut = (n: number) => `(${n} rows of this turn left out)`;
		const lines: string[] = [`Thread title: ${thread.title ?? "Untitled"}`];
		const files = new Set<string>();
		const calls: string[] = [];
		const edits: string[] = [];
		for (const r of rows) {
			if (gap && r === tail[0]) lines.push(leftOut(gap));
			const e = parse(r.event);
			if (!e) continue;
			const mark =
				rowKey(r.branchId, r.seq) === key ? " (the cited message)" : "";
			if (e.kind === "operator_message" && e.text.trim())
				lines.push(`User asked${mark}:\n${reply(e.text.trim(), mark)}`);
			if (e.kind !== "agent_step") continue;
			if (e.text.trim())
				lines.push(`Agent said${mark}:\n${reply(e.text.trim(), mark)}`);
			for (const c of e.toolCalls) {
				calls.push(`- ${c.name} ${cut(JSON.stringify(c.args), CALL_CHARS)}`);
				for (const k of PATH_KEYS) {
					const p = c.args[k];
					if (typeof p === "string") files.add(p);
				}
				const change = EDIT_KEYS.map((k) => c.args[k]).find(
					(v) => v !== undefined,
				);
				if (change !== undefined)
					edits.push(
						`- ${c.name} ${String(c.args.path ?? c.args.file_path ?? "")}\n${cut(typeof change === "string" ? change : JSON.stringify(change), EDIT_CHARS)}`,
					);
			}
		}
		if (rest) lines.push(leftOut(rest));
		if (calls.length)
			lines.push(`Tool calls:\n${calls.slice(0, 60).join("\n")}`);
		if (edits.length) lines.push(`Edits:\n${edits.slice(0, 20).join("\n")}`);
		if (files.size)
			lines.push(
				`Files touched:\n${[...files].map((f) => `- ${f}`).join("\n")}`,
			);
		if (thread.pullRequests.length)
			lines.push(
				`Pull requests:\n${thread.pullRequests
					.map(
						(p) =>
							`- ${p.repo}#${p.number}, ${p.state}: ${p.title ?? ""} ${p.url}`,
					)
					.join("\n")}`,
			);
		// A reset under these reads may have swapped the cited row for a rerun's (#1195).
		if (gen === null || (await this.generation(threadId)) !== gen) return null;
		return {
			threadId,
			key,
			turn: span.turn,
			link: `${threadLink(thread)}#item-${encodeURIComponent(key)}`,
			body: fenceUntrusted(
				"CITED_TURN",
				`Turn ${span.turn} of another PrismaLens thread (status ${thread.status}), around the message the user cited; its agent and tools wrote it.`,
				sanitizeUntrustedBlock(lines.join("\n\n")),
				"answer",
			),
		};
	}
}

/** The part of the thread search the `#` menu reads: message text across threads. */
export interface MessageSearch {
	searchMessages(input: { q: string; limit: number }): Promise<{
		hits: {
			threadId: string;
			title: string | null;
			key: string;
			snippet: string;
		}[];
	}>;
}

/** `#` finds messages by their words in every other thread (#1195); the message itself goes fenced at send. */
export class MessagesProvider implements ReferenceProvider {
	readonly source = "PrismaLens";
	readonly kinds: readonly ReferenceKind[] = ["message"];

	constructor(private readonly finder: () => MessageSearch | null) {}

	async search(
		q: string,
		ctx: ReferenceContext,
	): Promise<ReferenceCandidate[]> {
		const words = q.trim();
		const finder = this.finder();
		if (words.length < 2 || !finder) return [];
		const { hits } = await finder.searchMessages({ q: words, limit: 10 });
		return hits
			.filter((h) => h.threadId !== ctx.threadId)
			.map((h) => ({
				ref: {
					kind: "message" as const,
					id: messageRefId(h.threadId, h.key),
					label: cut(h.snippet.replace(/\s+/g, " ").trim() || "Message", 120),
				},
				detail: (h.title ?? "Untitled thread").slice(0, 300),
				group: "Messages",
			}));
	}

	/** Never asked: `compose` sends a cited message itself. */
	async snapshot(): Promise<ReferenceSnapshot | null> {
		return null;
	}
}
