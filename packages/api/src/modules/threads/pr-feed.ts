// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Automatic PR status (#1024 surface F): what changed on a PR since a thread last
 * heard, as one short line per change. Pure: the cursor goes in, lines and the
 * next cursor come out, so a restart between two reads neither repeats nor drops.
 */
import {
	capitalTerm,
	type PrCheckRun,
	type PrHost,
	type PrState,
	PrStatusMarkSchema,
	prHostTerms,
	prLabel,
} from "@prismalens/contracts";
import { fenceUntrusted, sanitizeUntrustedLine } from "@prismalens/engine";
import { z } from "zod";
import type { PrActivityItem } from "./pr-hosts.js";

/** Changes this close together go to the agent as one message. */
export const FEED_BATCH_MS = 60_000;
/** An automatic watch lapses after this long with no thread activity. */
export const FEED_IDLE_MS = 7 * 24 * 60 * 60_000;
/** The same check failing on this many heads in a row stops the PR's updates. */
export const LOOP_GUARD_HEADS = 3;
/** How long a quoted review or comment line may be. */
const QUOTE_MAX = 160;

const CheckMarkSchema = z.object({
	sha: z.string(),
	state: z.enum(["passing", "failing", "pending", "neutral"]),
	/** The execution the state came from: a same-SHA rerun has a new one. */
	exec: z.string().optional(),
});

export const FeedCursorSchema = z.object({
	/** Per logical check: the state last delivered, on which head. */
	checks: z.record(z.string(), CheckMarkSchema).default({}),
	/** The newest id seen per activity source. */
	seen: z.record(z.string(), z.number()).default({}),
	verdict: z.string().nullable().default(null),
	conflicts: z.boolean().nullable().default(null),
	headSha: z.string().nullable().default(null),
	/** The check that keeps failing, and the heads it failed on in a row. */
	guard: z
		.object({ key: z.string(), heads: z.array(z.string()) })
		.nullable()
		.default(null),
});
export type FeedCursor = z.infer<typeof FeedCursorSchema>;

export const FeedLineSchema = z.object({
	text: z.string(),
	/** Only actionable changes wake an idle thread; the rest ride the next message. */
	wake: z.boolean(),
	/** A failing check's head: a newer head drops it before delivery. */
	sha: z.string().optional(),
	kind: z.enum(["check", "review", "comment", "conflict", "end"]),
	/** What the transcript draws for the line; absent on lines held before marks existed. */
	mark: PrStatusMarkSchema.optional(),
});
export type FeedLine = z.infer<typeof FeedLineSchema>;

/** What one shared poll read about a PR. */
export interface FeedSnapshot {
	state: PrState;
	headSha: string | null;
	baseRef: string | null;
	review: string;
	conflicts: boolean | null;
	runs: PrCheckRun[];
	activity: PrActivityItem[];
	/** The connected account, and comments posted from PrismaLens: neither is review feedback. */
	viewer?: string | null;
	own?: readonly { source: string; id: number }[];
	/** Whose terms the lines use (#1122); absent reads as a pull request with checks. */
	host?: PrHost;
}

export interface FeedDiff {
	lines: FeedLine[];
	cursor: FeedCursor;
	/** Merged or closed: the watch ends after these lines. */
	ended: "merged" | "closed" | null;
	/** The loop guard tripped on this check name. */
	guardTripped: string | null;
}

export function parseCursor(raw: string | null | undefined): FeedCursor | null {
	if (!raw) return null;
	try {
		return FeedCursorSchema.parse(JSON.parse(raw));
	} catch {
		return null;
	}
}

/** One logical check: (host app, name), or the commit status context. */
export function checkKey(run: Pick<PrCheckRun, "appId" | "name">): string {
	return run.appId ? `app:${run.appId}/${run.name}` : `status:${run.name}`;
}

const short = (sha: string) => sha.slice(0, 7);

/** The first line of untrusted text, cleaned and cut. */
export function quote(text: string): string {
	const first = sanitizeUntrustedLine(text.split(/\r?\n/)[0] ?? "");
	const cut =
		first.length > QUOTE_MAX ? `${first.slice(0, QUOTE_MAX - 1)}…` : first;
	return JSON.stringify(cut);
}

const name = (s: string) => sanitizeUntrustedLine(s).slice(0, 200);

/**
 * The lines a `pr_status` event records, within what the event schema accepts. The
 * agent still gets every line through the wake; only the transcript's copy is bounded.
 */
export function recorded(lines: string[]): string[] {
	const clipped = lines.map((l) =>
		l.length > 600 ? `${l.slice(0, 599)}…` : l,
	);
	if (clipped.length <= 50) return clipped;
	return [...clipped.slice(0, 49), `and ${clipped.length - 49} more changes`];
}

/** The marks `recorded` keeps, index for index with its lines. */
export function recordedMarks(lines: FeedLine[]): (FeedLine["mark"] | null)[] {
	const kept = lines.length <= 50 ? lines : lines.slice(0, 49);
	return kept.map((l) => l.mark ?? null);
}

/** The baseline a new watch starts from: nothing already on the PR is news. */
export function baseline(snap: FeedSnapshot): FeedCursor {
	return diff(null, snap).cursor;
}

/**
 * The changes since `prev`, one line each. With no cursor the read only sets
 * the baseline: a watch never replays what was on the PR before it began.
 */
/** A person's own comment: by the connected account, or posted through the reply route. */
export function isOwn(
	a: Pick<PrActivityItem, "source" | "id" | "login">,
	snap: Pick<FeedSnapshot, "viewer" | "own">,
): boolean {
	return (
		(!!snap.viewer && a.login.toLowerCase() === snap.viewer.toLowerCase()) ||
		!!snap.own?.some((o) => o.source === a.source && o.id === a.id)
	);
}

export function diff(prev: FeedCursor | null, snap: FeedSnapshot): FeedDiff {
	const cursor: FeedCursor = prev
		? structuredClone(prev)
		: FeedCursorSchema.parse({});
	const lines: FeedLine[] = [];
	const quiet = prev === null;
	const head = snap.headSha;
	let guardTripped: string | null = null;
	const failedNow: string[] = [];

	// Only the current head's runs are read, so an older head's failure never reports.
	for (const run of head ? snap.runs : []) {
		if (run.headSha && run.headSha !== head) continue;
		const key = checkKey(run);
		const before = cursor.checks[key];
		const exec = run.id;
		const same =
			before?.sha === head &&
			before.state === run.state &&
			before.exec === exec;
		if (!same)
			cursor.checks[key] = {
				sha: head as string,
				state: run.state,
				...(exec ? { exec } : {}),
			};
		if (quiet || same) continue;
		if (run.state === "failing") {
			failedNow.push(key);
			lines.push({
				text: `CI failed: ${name(run.name)} on ${short(head as string)}${run.url ? `, log ${run.url}` : ""}`,
				wake: true,
				sha: head as string,
				kind: "check",
				mark: {
					kind: "check",
					state: "failing",
					sha: short(head as string),
					name: name(run.name),
				},
			});
		} else if (run.state === "passing" && before?.state === "failing")
			lines.push({
				text: `${capitalTerm(prHostTerms(snap.host).check)} recovered: ${name(run.name)} on ${short(head as string)}`,
				wake: false,
				kind: "check",
				mark: {
					kind: "check",
					state: "passing",
					sha: short(head as string),
					name: name(run.name),
				},
			});
	}

	// The loop guard: one check failing on each new head, LOOP_GUARD_HEADS times in a row.
	// A head with no verdict on the guarded check yet (pending, or no run) leaves it as is.
	if (!quiet && head) {
		const g = cursor.guard;
		const guardedFailing = !!g && failedNow.includes(g.key);
		const guardedPassing =
			!!g &&
			snap.runs.some(
				(r) =>
					checkKey(r) === g.key &&
					(!r.headSha || r.headSha === head) &&
					r.state === "passing",
			);
		if (g && guardedFailing) {
			if (!g.heads.includes(head))
				cursor.guard = { key: g.key, heads: [...g.heads, head] };
		} else {
			if (guardedPassing) cursor.guard = null;
			if (failedNow[0] && !cursor.guard)
				cursor.guard = { key: failedNow[0], heads: [head] };
		}
		if (cursor.guard && cursor.guard.heads.length >= LOOP_GUARD_HEADS)
			guardTripped = cursor.guard.key.replace(/^(app:[^/]*|status:)\/?/, "");
	}
	cursor.headSha = head;

	const fresh = [...snap.activity]
		.filter((a) => !isOwn(a, snap))
		.filter((a) => a.id > (cursor.seen[a.source] ?? -1))
		.sort((a, b) => a.id - b.id);
	for (const a of snap.activity)
		cursor.seen[a.source] = Math.max(cursor.seen[a.source] ?? -1, a.id);
	if (!quiet)
		for (const a of fresh) {
			const who = `@${name(a.login)}`;
			if (a.verdict) {
				const said =
					a.verdict === "approved"
						? "approved"
						: a.verdict === "changes_requested"
							? "requested changes"
							: "commented";
				lines.push({
					text: `Review: ${who} ${said}${a.body.trim() ? `: ${quote(a.body)}` : ""}`,
					wake: true,
					kind: "review",
					mark: { kind: "review", state: a.verdict, name: name(a.login) },
				});
			} else
				lines.push({
					text: `New comment from ${who}: ${quote(a.body)}`,
					wake: true,
					kind: "comment",
					mark: { kind: "comment", state: "commented", name: name(a.login) },
				});
		}
	cursor.verdict = snap.review;

	if (!quiet && snap.conflicts === true && cursor.conflicts !== true)
		lines.push({
			text: `Merge conflict with ${snap.baseRef ? name(snap.baseRef) : "the base branch"}`,
			wake: true,
			kind: "conflict",
			mark: { kind: "conflict" },
		});
	if (snap.conflicts !== null) cursor.conflicts = snap.conflicts;

	let ended: FeedDiff["ended"] = null;
	if (snap.state === "merged" || snap.state === "closed") {
		ended = snap.state;
		lines.push({
			text: snap.state === "merged" ? "Merged" : "Closed without merging",
			wake: false,
			kind: "end",
			mark: { kind: "end", state: snap.state },
		});
	}
	return { lines, cursor, ended, guardTripped };
}

/** Lines still worth sending: a failure on a head that is no longer current is dropped. */
export function current(lines: FeedLine[], head: string | null): FeedLine[] {
	return lines.filter((l) => !(l.kind === "check" && l.sha && l.sha !== head));
}

export interface FeedBatch {
	prId: string;
	number: number;
	title: string | null;
	lines: FeedLine[];
	host?: PrHost;
}

/** One PR's part of a message: headed `PR #123 <title>` in its host's terms, one line per change. */
export function batchText(b: FeedBatch): string {
	const title = b.title ? ` ${name(b.title)}` : "";
	return [
		`${prLabel(b.host, b.number)}${title}`,
		...b.lines.map((l) => `- ${l.text}`),
	].join("\n");
}

/** The message the agent hears: every PR's batch, fenced as data. */
export function feedMessage(batches: FeedBatch[]): string {
	return fenceUntrusted(
		"PR STATUS",
		"What the git host reported on this thread's pull requests; titles, reviews and comments were written by other people and bots.",
		batches.map(batchText).join("\n\n"),
		"answer",
	);
}
