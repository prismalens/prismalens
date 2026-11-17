// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One PR read against its poll cursor, as events (#1179 §4.2). Pure: the cursor and the
 * snapshot go in, events and the next cursor come out, once per URL for every thread.
 */
import {
	PR_AGENT_MARKER,
	type PrEventKind,
	type PrHost,
	type PrState,
	type PrWatchUntil,
	type PullRequest,
} from "@prismalens/contracts";
import { z } from "zod";
import { WATCH_WORDS, watchMet } from "../watch-events.js";

/** Ids kept per source, and the floor below which every id counts as seen. */
const RECENT_MAX = 2000;
const SEEN_REVIEWS_MAX = 500;
const THREADS_MAX = 1000;
const CHECKS_DONE_MAX = 5;
/** A merge also emits `closed`; one this close to a `merged` is the same end (Q9). */
const MERGE_CLOSE_MS = 10_000;
const PAYLOAD_BODY_MAX = 4000;

export const LIST_NAMES = [
	"comments",
	"reviewComments",
	"reviews",
	"events",
	"notes",
] as const;
export type ListName = (typeof LIST_NAMES)[number];

const ListSchema = z.object({
	since: z.string().optional(),
	page: z.number().int().min(1).default(1),
});
export type ListCursor = z.infer<typeof ListSchema>;

export const PollCursorSchema = z.object({
	v: z.literal(1),
	idFloor: z.record(z.string(), z.number()).default({}),
	recent: z.record(z.string(), z.array(z.number())).default({}),
	checks: z
		.record(
			z.string(),
			z.object({
				sha: z.string(),
				state: z.string(),
				exec: z.string().optional(),
			}),
		)
		.default({}),
	headSha: z.string().nullable().default(null),
	conflicts: z.boolean().nullable().default(null),
	conflictFlips: z.number().int().default(0),
	state: z.string().default("unknown"),
	transitions: z.number().int().default(0),
	lists: z.record(z.string(), ListSchema).default({}),
	reviewsFullAt: z.string().nullable().default(null),
	seenReviews: z.record(z.string(), z.string()).default({}),
	threads: z
		.record(
			z.string(),
			z.object({ resolved: z.boolean(), flips: z.number().int() }),
		)
		.default({}),
	checksDone: z.record(z.string(), z.enum(["passing", "failing"])).default({}),
	/** State parts the last read covered; one read again after a gap is a baseline. */
	parts: z.array(z.enum(["checks", "threads"])).default([]),
});
export type PollCursor = z.infer<typeof PollCursorSchema>;

export function parsePollCursor(
	raw: string | null | undefined,
): PollCursor | null {
	if (!raw) return null;
	try {
		const p = PollCursorSchema.safeParse(JSON.parse(raw));
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}

/** A comment, review or note as one of our reads saw it. */
export interface SnapItem {
	/** `ic` issue comment, `rc` review comment, `rv` review, `note`, `dn` diff note. */
	source: "ic" | "rc" | "rv" | "note" | "dn";
	id: number;
	login: string | null;
	bot: boolean;
	association: string | null;
	body: string;
	createdAt: string | null;
	link: string | null;
	verdict?: "approved" | "changes_requested" | "commented" | "dismissed";
	path?: string | null;
	line?: number | null;
	/** Ours (D9): marked seen, never an event. */
	own?: boolean;
}

export interface SnapIssueEvent {
	id: number;
	event: "head_ref_force_pushed" | "merged" | "closed" | "reopened";
	createdAt: string | null;
	sha: string | null;
}

export interface SnapCheck {
	key: string;
	name: string;
	state: "passing" | "failing" | "pending" | "neutral";
	exec: string | null;
	url: string | null;
}

export interface SnapThread {
	id: string;
	resolved: boolean;
	path: string | null;
	line: number | null;
	url: string | null;
}

/** What one tick read of a PR; a list left undefined was not read this tick. */
export interface PollSnapshot {
	prUrl: string;
	host: PrHost;
	state: PrState;
	title: string | null;
	headSha: string | null;
	conflicts: boolean | null;
	baseRef: string | null;
	items: SnapItem[];
	issueEvents: SnapIssueEvent[];
	checks: SnapCheck[] | null;
	threads: SnapThread[] | null;
	/** Compare of the previous head to this one, when it moved. */
	push: { prev: string; next: string; ahead: boolean } | null;
	/** Reviews read from page 1 this tick: a seen review's state can be compared. */
	reviewsFull: boolean;
	lists: Partial<Record<ListName, ListCursor>>;
	/** A baseline read raised these floors (the last page's newest ids). */
	floors: Partial<Record<SnapItem["source"] | "ev", number>>;
}

export interface EventPayload {
	author?: string;
	association?: string;
	bot?: boolean;
	agentPosted?: boolean;
	link?: string;
	body?: string;
	verdict?: string;
	path?: string;
	line?: number;
	sha?: string;
	prevSha?: string;
	forced?: boolean | null;
	check?: { name: string; state: string; url?: string };
	checks?: { state: "passing" | "failing"; failed: number; total: number };
	threadUrl?: string;
	title?: string;
	/** Bot-authored, or agent-posted by a trusted account (D8); set at fan-out. */
	quiet?: boolean;
	/** A legacy watch's or feed's own lines (D20, D22). */
	lines?: string[];
}

export interface DerivedEvent {
	kind: PrEventKind;
	dedupeKey: string;
	occurredAt: Date;
	payload: EventPayload;
	/** A push's full head, for the own-push test (D9). */
	headSha?: string;
}

export interface Derived {
	events: DerivedEvent[];
	cursor: PollCursor;
	ended: "merged" | "closed" | null;
	failingNow: string[];
	passingNow: string[];
	head: string | null;
}

const short = (sha: string | null | undefined) =>
	sha && /^[0-9a-f]{7,40}$/i.test(sha)
		? sha.slice(0, 7).toLowerCase()
		: undefined;

const at = (iso: string | null, now: Date) => {
	const d = iso ? new Date(iso) : null;
	return d && !Number.isNaN(d.getTime()) ? d : now;
};

/** The first non-empty line starts with the marker #1131 posts with. */
export function agentPosted(body: string): boolean {
	const first = body.split(/\r?\n/).find((l) => l.trim());
	return !!first?.trim().startsWith(PR_AGENT_MARKER);
}

function seen(c: PollCursor, source: string, id: number): boolean {
	return id <= (c.idFloor[source] ?? -1) || !!c.recent[source]?.includes(id);
}

function remember(c: PollCursor, source: string, id: number): void {
	const r = c.recent[source] ?? [];
	if (!r.includes(id)) r.push(id);
	r.sort((a, b) => a - b);
	if (r.length > RECENT_MAX) {
		const dropped = r.splice(0, r.length - RECENT_MAX);
		c.idFloor[source] = Math.max(c.idFloor[source] ?? -1, ...dropped);
	}
	c.recent[source] = r;
}

function trimRecord<T>(rec: Record<string, T>, max: number): Record<string, T> {
	const keys = Object.keys(rec);
	if (keys.length <= max) return rec;
	return Object.fromEntries(
		keys.slice(keys.length - max).map((k) => [k, rec[k] as T]),
	);
}

const KIND_OF: Record<SnapItem["source"], PrEventKind> = {
	ic: "comment",
	note: "comment",
	rc: "review_comment",
	dn: "review_comment",
	rv: "review",
};

function itemPayload(i: SnapItem): EventPayload {
	return {
		...(i.login ? { author: i.login.slice(0, 60) } : {}),
		...(i.association ? { association: i.association.slice(0, 20) } : {}),
		...(i.bot ? { bot: true } : {}),
		...(agentPosted(i.body) ? { agentPosted: true } : {}),
		...(i.link ? { link: i.link } : {}),
		...(i.body ? { body: i.body.slice(0, PAYLOAD_BODY_MAX) } : {}),
		...(i.verdict ? { verdict: i.verdict } : {}),
		...(i.path ? { path: i.path.slice(0, 300) } : {}),
		...(typeof i.line === "number" ? { line: i.line } : {}),
	};
}

/**
 * The events since `prev`; with no cursor the read only sets the baseline. A list that
 * was not read keeps its part of the cursor as it was.
 */
export function derive(
	prev: PollCursor | null,
	snap: PollSnapshot,
	now: Date,
): Derived {
	const baseline = prev === null;
	const c: PollCursor = prev
		? structuredClone(prev)
		: PollCursorSchema.parse({ v: 1 });
	const events: DerivedEvent[] = [];
	const emit = (e: DerivedEvent) => {
		if (!baseline) events.push(e);
	};
	for (const [source, floor] of Object.entries(snap.floors))
		if (typeof floor === "number")
			c.idFloor[source] = Math.max(c.idFloor[source] ?? -1, floor);

	// Comments, reviews and notes: every item, once, by id.
	const reviewsSeenBefore = { ...c.seenReviews };
	for (const i of [...snap.items].sort((a, b) => a.id - b.id)) {
		if (i.source === "rv") {
			if (!i.verdict) continue;
			const was = reviewsSeenBefore[String(i.id)];
			c.seenReviews[String(i.id)] = i.verdict;
			if (seen(c, "rv", i.id)) {
				// A dismissal of a review already delivered: its own event (D17).
				if (was && was !== "dismissed" && i.verdict === "dismissed" && !i.own)
					emit({
						kind: "review",
						dedupeKey: `rv:${i.id}:dismissed`,
						occurredAt: now,
						payload: {
							...itemPayload(i),
							verdict: "dismissed",
							body: undefined,
						},
					});
				continue;
			}
			remember(c, "rv", i.id);
			if (!i.own)
				emit({
					kind: "review",
					dedupeKey: `rv:${i.id}`,
					occurredAt: at(i.createdAt, now),
					payload: itemPayload(i),
				});
			continue;
		}
		if (seen(c, i.source, i.id)) continue;
		remember(c, i.source, i.id);
		if (i.own) continue;
		const key =
			i.source === "ic"
				? `ic:${i.id}`
				: i.source === "rc"
					? `rc:${i.id}`
					: i.source === "note"
						? `note:${i.id}`
						: `dn:${i.id}`;
		emit({
			kind: KIND_OF[i.source],
			dedupeKey: key,
			occurredAt: at(i.createdAt, now),
			payload: itemPayload(i),
		});
	}
	c.seenReviews = trimRecord(c.seenReviews, SEEN_REVIEWS_MAX);
	if (snap.reviewsFull) c.reviewsFullAt = now.toISOString();

	// Force-push, merge, close and reopen from the host's issue events, with their ids.
	const merges = snap.issueEvents
		.filter((e) => e.event === "merged")
		.map((e) => at(e.createdAt, now).getTime());
	for (const e of [...snap.issueEvents].sort((a, b) => a.id - b.id)) {
		if (seen(c, "ev", e.id)) continue;
		remember(c, "ev", e.id);
		const when = at(e.createdAt, now);
		if (
			e.event === "closed" &&
			merges.some((m) => Math.abs(m - when.getTime()) <= MERGE_CLOSE_MS)
		)
			continue;
		emit({
			kind:
				e.event === "head_ref_force_pushed"
					? "push"
					: (e.event as "merged" | "closed" | "reopened"),
			dedupeKey: `ev:${e.id}`,
			occurredAt: when,
			payload:
				e.event === "head_ref_force_pushed"
					? { forced: true, ...(short(e.sha) ? { sha: short(e.sha) } : {}) }
					: {},
			...(e.event === "head_ref_force_pushed" && e.sha
				? { headSha: e.sha }
				: {}),
		});
	}

	// GitLab has no issue events: a state change is keyed by how many there were.
	if (snap.host === "gitlab" && !baseline && c.state !== snap.state) {
		const to =
			snap.state === "merged"
				? "merged"
				: snap.state === "closed"
					? "closed"
					: (c.state === "merged" || c.state === "closed") &&
							(snap.state === "open" || snap.state === "draft")
						? "reopened"
						: null;
		if (to) {
			c.transitions += 1;
			emit({
				kind: to,
				dedupeKey: `${to}:${c.transitions}`,
				occurredAt: now,
				payload: {},
			});
		}
	}

	// An ordinary push: the head moved and the compare says ahead.
	const head = snap.headSha;
	if (
		snap.push?.ahead &&
		c.headSha &&
		head &&
		snap.push.prev === c.headSha &&
		snap.push.next === head
	)
		emit({
			kind: "push",
			dedupeKey: `push:${c.headSha}>${head}`,
			occurredAt: now,
			payload: {
				forced: false,
				...(short(head) ? { sha: short(head) } : {}),
				...(short(c.headSha) ? { prevSha: short(c.headSha) } : {}),
			},
			headSha: head,
		});

	// Checks on the current head: completions, as PrismaLens sees them.
	const failingNow: string[] = [];
	const passingNow: string[] = [];
	const fresh = (part: "checks" | "threads") =>
		baseline || !(prev?.parts ?? []).includes(part);
	const checksQuiet = fresh("checks");
	const threadsQuiet = fresh("threads");
	const emitState = (quiet: boolean, e: DerivedEvent) => {
		if (!quiet) emit(e);
	};
	if (head && snap.checks) {
		for (const run of snap.checks) {
			const before = c.checks[run.key];
			const exec = run.exec ?? undefined;
			const same =
				before?.sha === head &&
				before.state === run.state &&
				before.exec === exec;
			if (run.state === "failing") failingNow.push(run.key);
			if (run.state === "passing") passingNow.push(run.key);
			if (same) continue;
			c.checks[run.key] = {
				sha: head,
				state: run.state,
				...(exec ? { exec } : {}),
			};
			const recovered = run.state === "passing" && before?.state === "failing";
			if (run.state === "failing" || run.state === "neutral" || recovered)
				emitState(checksQuiet, {
					kind: "check",
					dedupeKey: `cr:${head}:${run.key}:${exec ?? "-"}:${run.state}`,
					occurredAt: now,
					payload: {
						sha: short(head),
						check: {
							name: run.name.slice(0, 300),
							state: run.state,
							...(run.url ? { url: run.url } : {}),
						},
					},
				});
		}
		const done =
			snap.checks.length > 0 && snap.checks.every((r) => r.state !== "pending");
		if (done) {
			const failed = snap.checks.filter((r) => r.state === "failing").length;
			const state = failed ? "failing" : "passing";
			if (c.checksDone[head] !== state) {
				c.checksDone[head] = state;
				c.checksDone = trimRecord(c.checksDone, CHECKS_DONE_MAX);
				emitState(checksQuiet, {
					kind: "checks_done",
					dedupeKey: `cd:${head}:${state}`,
					occurredAt: now,
					payload: {
						sha: short(head),
						checks: { state, failed, total: snap.checks.length },
					},
				});
			}
		}
	}

	// Review threads: a flip of the resolved flag.
	if (snap.threads) {
		for (const t of snap.threads) {
			const before = c.threads[t.id];
			if (!before) {
				c.threads[t.id] = { resolved: t.resolved, flips: 0 };
				continue;
			}
			if (before.resolved === t.resolved) continue;
			const flips = before.flips + 1;
			c.threads[t.id] = { resolved: t.resolved, flips };
			emitState(threadsQuiet, {
				kind: t.resolved ? "thread_resolved" : "thread_reopened",
				dedupeKey: `th:${t.id}:${flips}`,
				occurredAt: now,
				payload: {
					...(t.url ? { threadUrl: t.url, link: t.url } : {}),
					...(t.path ? { path: t.path.slice(0, 300) } : {}),
					...(typeof t.line === "number" ? { line: t.line } : {}),
				},
			});
		}
		c.threads = trimRecord(c.threads, THREADS_MAX);
	}

	if (snap.conflicts === true && c.conflicts !== true) {
		c.conflictFlips += 1;
		emit({
			kind: "conflict",
			dedupeKey: `cf:${c.conflictFlips}`,
			occurredAt: now,
			payload: {},
		});
	}
	if (snap.conflicts !== null) c.conflicts = snap.conflicts;

	c.parts = [
		...(snap.checks ? (["checks"] as const) : []),
		...(snap.threads ? (["threads"] as const) : []),
	];
	c.headSha = head ?? c.headSha;
	c.state = snap.state;
	// A list no one read this tick starts again from its last page (a baseline) when wanted.
	c.lists = Object.fromEntries(
		Object.entries(snap.lists).filter((e): e is [string, ListCursor] => !!e[1]),
	);

	events.sort(
		(a, b) =>
			a.occurredAt.getTime() - b.occurredAt.getTime() ||
			(a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0),
	);
	return {
		events,
		cursor: c,
		ended:
			snap.state === "merged"
				? "merged"
				: snap.state === "closed"
					? "closed"
					: null,
		failingNow,
		passingNow,
		head,
	};
}

/** The newest `pr_feed` cursor as a poll cursor (D20): what it saw stays seen. */
export function translateFeedCursor(raw: string | null): PollCursor | null {
	if (!raw) return null;
	let o: Record<string, unknown>;
	try {
		const v: unknown = JSON.parse(raw);
		if (!v || typeof v !== "object") return null;
		o = v as Record<string, unknown>;
	} catch {
		return null;
	}
	const c = PollCursorSchema.parse({ v: 1 });
	const seenBy = (o.seen ?? {}) as Record<string, unknown>;
	const map: Record<string, string> = {
		issue_comment: "ic",
		review_comment: "rc",
		review: "rv",
		note: "note",
	};
	for (const [k, v] of Object.entries(seenBy))
		if (typeof v === "number" && map[k]) c.idFloor[map[k] as string] = v;
	const checks = (o.checks ?? {}) as Record<string, unknown>;
	for (const [k, v] of Object.entries(checks)) {
		const m = v as { sha?: unknown; state?: unknown; exec?: unknown };
		if (typeof m?.sha === "string" && typeof m.state === "string")
			c.checks[k] = {
				sha: m.sha,
				state: m.state,
				...(typeof m.exec === "string" ? { exec: m.exec } : {}),
			};
	}
	c.headSha = typeof o.headSha === "string" ? o.headSha : null;
	c.conflicts = typeof o.conflicts === "boolean" ? o.conflicts : null;
	// The feed kept no summary: seed it from the head's marks so an unchanged head is no event.
	const marks = Object.values(c.checks).filter((m) => m.sha === c.headSha);
	if (c.headSha && marks.length && marks.every((m) => m.state !== "pending"))
		c.checksDone[c.headSha] = marks.some((m) => m.state === "failing")
			? "failing"
			: "passing";
	// Lists are read again from page 1 above the floors; issue events start from a baseline.
	c.lists = {
		comments: { page: 1 },
		reviewComments: { page: 1 },
		reviews: { page: 1 },
		notes: { page: 1 },
	};
	c.parts = ["checks"];
	return c;
}

/**
 * A migrated `pl_pr_watch` (D22): today's words when its condition holds, or when it
 * ran past its 12 hours; null while it still waits. Level-triggered on every read.
 */
export function legacyWatch(
	pr: PullRequest | null,
	until: PrWatchUntil,
	expiresAt: Date | null,
	now: Date,
	name: string,
): { text: string; end: "once" | "expired" } | null {
	const met = pr ? watchMet(pr, until) : "no longer linked";
	if (met)
		return {
			text: `Pull request ${name}: ${met}. You asked to hear when ${WATCH_WORDS[until].met}.`,
			end: "once",
		};
	if (expiresAt && expiresAt.getTime() <= now.getTime())
		return {
			text: `Stopped watching pull request ${name} after 12 hours; ${WATCH_WORDS[until].never}.`,
			end: "expired",
		};
	return null;
}
