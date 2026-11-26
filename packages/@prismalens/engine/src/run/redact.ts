// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { GITHUB_TOKEN_VARS } from "@prismalens/agent-host";

/** Shorter values would redact ordinary words; real tokens and bearers are longer. */
const MIN_SECRET = 12;

/**
 * The credential values a run's agent may hold: GitHub tokens in its env (any letter case,
 * as Windows reads names) and PrismaLens's own extras such as the gateway bearer (#1020).
 */
export function injectedSecrets(
	env: Readonly<Record<string, string | undefined>>,
	extra: readonly (string | undefined)[] = [],
): string[] {
	const names = new Set<string>(GITHUB_TOKEN_VARS);
	const values = [
		...Object.entries(env)
			.filter(([k]) => names.has(k.toUpperCase()))
			.map(([, v]) => v),
		...extra,
	];
	return [
		...new Set(
			values.filter((v): v is string => !!v && v.length >= MIN_SECRET),
		),
	];
}

/** Each secret raw and JSON-escaped, longest first, so text holding encoded JSON is caught too. */
function forms(secrets: readonly string[]): string[] {
	return [
		...new Set(secrets.flatMap((s) => [s, JSON.stringify(s).slice(1, -1)])),
	].sort((x, y) => y.length - x.length);
}

/** Event fields whose contents the agent wrote; a `kind` inside them is data, not a discriminator. */
const FREE_FIELDS = new Set(["args", "input", "rawInput", "modelUsage"]);

/**
 * The event with every exact secret value replaced inside its string values; keys and schema
 * `kind` fields are never touched, so redaction cannot change an event's shape (#1180 §3.3).
 * The same object when none occurs.
 */
export function redactEvent<T>(event: T, secrets: readonly string[]): T {
	if (!secrets.length) return event;
	const all = forms(secrets);
	let changed = false;
	const walk = (
		v: unknown,
		key: string | undefined,
		free: boolean,
	): unknown => {
		if (typeof v === "string") {
			if (key === "kind" && !free) return v;
			const out = scrub(v, all);
			if (out !== v) changed = true;
			return out;
		}
		if (Array.isArray(v)) return v.map((x) => walk(x, undefined, free));
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v).map(([k, x]) => [
					k,
					walk(x, k, free || FREE_FIELDS.has(k)),
				]),
			);
		return v;
	};
	const out = walk(event, undefined, false);
	return changed ? (out as T) : event;
}

/** A wire line with each secret replaced inside its JSON string values, or as text when it does not parse. */
export function redactLine(line: string, secrets: readonly string[]): string {
	if (!secrets.length) return line;
	const all = forms(secrets);
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return scrub(line, all);
	}
	let changed = false;
	const walk = (v: unknown): unknown => {
		if (typeof v === "string") {
			const out = scrub(v, all);
			if (out !== v) changed = true;
			return out;
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v).map(([k, x]) => [k, walk(x)]),
			);
		return v;
	};
	const out = walk(parsed);
	return changed ? JSON.stringify(out) : line;
}

/**
 * The secrets a user handed this thread through `pl_secret_request` (#1024 spec B): each is
 * redacted whatever its length, unlike {@link injectedSecrets}, since the user said it is one.
 */
export function requestedSecrets(
	values: readonly (string | undefined)[] | undefined,
): string[] {
	return (
		[...new Set((values ?? []).filter((v): v is string => !!v))]
			// The longest first, so a secret inside another never leaves a piece behind.
			.sort((a, b) => b.length - a.length)
	);
}

/** `text` with every exact secret value replaced. */
export function scrub(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const s of secrets) out = out.replaceAll(s, "[redacted]");
	return out;
}

/** A piece of a unit; pieces of one channel (say, an agent's message text) are read as one text. */
export type StreamPiece = string | { text: string; channel: string };

const textOf = (p: StreamPiece) => (typeof p === "string" ? p : p.text);
const channelOf = (p: StreamPiece) => (typeof p === "string" ? "" : p.channel);

/**
 * Scrubs secrets that may be split across a stream's pieces (stderr chunks, wire records,
 * events). A unit (a chunk, or a record's string values) is released only once each of its
 * channels has at least the longest secret's length minus one after it, or the stream ends;
 * a secret spanning pieces of one channel is replaced in every piece it touches.
 */
export class StreamScrubber {
	private readonly secrets: string[];
	private readonly keep: number;
	private units: { pieces: StreamPiece[]; marks: [number, number][][] }[] = [];

	constructor(secrets: readonly string[]) {
		this.secrets = forms(secrets.filter((s) => s.length > 0));
		this.keep = Math.max(0, ...this.secrets.map((s) => s.length)) - 1;
	}

	/** Takes the next unit; returns the units now safe to release, scrubbed, in order. */
	push(pieces: readonly StreamPiece[]): string[][] {
		if (!this.secrets.length) return [pieces.map(textOf)];
		this.units.push({ pieces: [...pieces], marks: pieces.map(() => []) });
		return this.release(false);
	}

	/** Everything still held, scrubbed. */
	end(): string[][] {
		return this.release(true);
	}

	private release(ended: boolean): string[][] {
		const out: string[][] = [];
		while (this.units.length) {
			const head = this.units[0] as (typeof this.units)[number];
			const channels = [...new Set(head.pieces.map(channelOf))];
			const spans = channels.map((c) => this.span(c, head));
			if (!ended && spans.some((x) => x.after < this.keep)) break;
			for (const [i, c] of channels.entries()) {
				const { text, headLen } = spans[i] as (typeof spans)[number];
				for (const secret of this.secrets)
					for (
						let at = text.indexOf(secret);
						at !== -1 && at < headLen;
						at = text.indexOf(secret, at + 1)
					)
						this.mark(c, at, at + secret.length);
			}
			this.units.shift();
			out.push(
				head.pieces.map((p, i) => masked(textOf(p), head.marks[i] ?? [])),
			);
		}
		return out;
	}

	/** Channel `c`'s held text, how much of it the head unit holds, and how much follows. */
	private span(c: string, head: (typeof this.units)[number]) {
		const text = this.units
			.flatMap((u) => u.pieces.filter((p) => channelOf(p) === c).map(textOf))
			.join("");
		const headLen = head.pieces
			.filter((p) => channelOf(p) === c)
			.reduce((n, p) => n + textOf(p).length, 0);
		return { text, headLen, after: text.length - headLen };
	}

	/** Marks [start, end) of channel `c`'s held text in every piece it touches. */
	private mark(c: string, start: number, end: number): void {
		let offset = 0;
		for (const u of this.units)
			u.pieces.forEach((p, i) => {
				if (channelOf(p) !== c) return;
				const len = textOf(p).length;
				const from = Math.max(start, offset);
				const to = Math.min(end, offset + len);
				if (from < to) u.marks[i]?.push([from - offset, to - offset]);
				offset += len;
			});
	}
}

/** `piece` with each marked range replaced; touching ranges become one `[redacted]`. */
function masked(piece: string, marks: [number, number][]): string {
	if (!marks.length) return piece;
	const sorted = [...marks].sort((a, b) => a[0] - b[0]);
	let out = "";
	let at = 0;
	for (const [from, to] of sorted) {
		if (to <= at) continue;
		if (from > at) out += piece.slice(at, from);
		if (from >= at) out += "[redacted]";
		at = Math.max(at, to);
	}
	return out + piece.slice(at);
}

type Path = readonly (string | number)[];

/** Each string value of `v` in order with its path; `kind` fields are left out (#1180 §3.3). */
function leavesOf(v: unknown, path: Path = []): { path: Path; text: string }[] {
	if (typeof v === "string")
		return path[path.length - 1] === "kind" ? [] : [{ path, text: v }];
	if (Array.isArray(v)) return v.flatMap((x, i) => leavesOf(x, [...path, i]));
	if (v && typeof v === "object")
		return Object.entries(v).flatMap(([k, x]) => leavesOf(x, [...path, k]));
	return [];
}

function withLeaves(
	v: unknown,
	texts: Map<string, string>,
	path: Path = [],
): unknown {
	if (typeof v === "string") return texts.get(JSON.stringify(path)) ?? v;
	if (Array.isArray(v))
		return v.map((x, i) => withLeaves(x, texts, [...path, i]));
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v).map(([k, x]) => [
				k,
				withLeaves(x, texts, [...path, k]),
			]),
		);
	return v;
}

/**
 * Holds records of any shape (wire records, events) and scrubs their string values as one
 * stream per channel, so a value split across records, with others between, is still caught.
 * A value whose channel is null is left as it is. A record comes back the same object when
 * nothing in it changed, so its shape never does.
 */
export class RecordScrubber<T> {
	private readonly stream: StreamScrubber;
	private held: { record: T; leaves: { path: Path; text: string }[] }[] = [];

	constructor(
		secrets: readonly string[],
		private readonly channel: (record: T, path: Path) => string | null = () =>
			"",
	) {
		this.stream = new StreamScrubber(secrets);
	}

	/** Takes the next record; returns those now safe to release, in order. */
	push(record: T): T[] {
		const leaves = leavesOf(record).flatMap((l) => {
			const channel = this.channel(record, l.path);
			return channel === null ? [] : [{ ...l, channel }];
		});
		this.held.push({ record, leaves });
		return this.rebuild(
			this.stream.push(
				leaves.map((l) => ({ text: l.text, channel: l.channel })),
			),
		);
	}

	/** Every record still held, scrubbed. */
	end(): T[] {
		return this.rebuild(this.stream.end());
	}

	private rebuild(units: string[][]): T[] {
		return units.map((texts) => {
			const { record, leaves } =
				this.held.shift() as (typeof this.held)[number];
			const changed = new Map<string, string>();
			leaves.forEach((l, i) => {
				const t = texts[i] ?? l.text;
				if (t !== l.text) changed.set(JSON.stringify(l.path), t);
			});
			return changed.size ? (withLeaves(record, changed) as T) : record;
		});
	}
}
