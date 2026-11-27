// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { GITHUB_TOKEN_VARS } from "@prismalens/agent-host";
import { CanonicalEventSchema } from "@prismalens/contracts/schemas";

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

/**
 * Event fields whose contents are data: what the agent wrote, and records keyed by names someone
 * chose (an ask's form values, an alert's labels). A `kind` inside them is not a discriminator.
 */
const FREE_FIELDS = new Set([
	"args",
	"input",
	"rawInput",
	"modelUsage",
	"values",
	"answers",
	"labels",
	"annotations",
	"context",
	"journals",
]);

type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: unknown): Def | undefined =>
	(schema as { _zod?: { def?: Def } } | null)?._zod?.def;

/** The schemas inside `def`, each with the field name it sits under; a record's values have none. */
function children(def: Def, key: string): [unknown, string][] {
	const under = (xs: unknown[]) => xs.map((x): [unknown, string] => [x, key]);
	switch (def.type) {
		case "object":
			return Object.entries(def.shape as object).map(([k, v]) => [v, k]);
		case "record":
			return [[def.valueType, ""]];
		case "union":
			return under(def.options as unknown[]);
		case "tuple":
			return under(def.items as unknown[]);
		case "intersection":
			return under([def.left, def.right]);
		case "pipe":
			return under([def.in, def.out]);
		case "lazy":
			return under([(def.getter as () => unknown)()]);
		case "array":
			return under([def.element]);
		default:
			return "innerType" in def ? under([def.innerType]) : [];
	}
}

/**
 * Read once from the event schema: each field's fixed values (its enums and literals) and every
 * field name. Redaction keeps these, so a secret equal to `loads` cannot change a state (#1180 §3.3).
 */
let schemaWords:
	| { values: Map<string, Set<string>>; fields: Set<string> }
	| undefined;
function words() {
	if (schemaWords) return schemaWords;
	const values = new Map<string, Set<string>>();
	const fields = new Set<string>();
	const seen = new WeakMap<object, Set<string>>();
	const add = (key: string, vs: readonly unknown[]) => {
		const set = values.get(key) ?? new Set<string>();
		for (const v of vs) if (typeof v === "string") set.add(v);
		values.set(key, set);
	};
	const walk = (schema: unknown, key: string): void => {
		const def = defOf(schema);
		if (!def || typeof schema !== "object" || schema === null) return;
		const keys = seen.get(schema) ?? new Set<string>();
		if (keys.has(key)) return;
		seen.set(schema, keys.add(key));
		if (def.type === "enum") add(key, Object.values(def.entries as object));
		if (def.type === "literal") add(key, def.values as unknown[]);
		if (def.type === "object")
			for (const k of Object.keys(def.shape as object)) fields.add(k);
		for (const [child, k] of children(def, key)) walk(child, k);
	};
	walk(CanonicalEventSchema, "");
	schemaWords = { values, fields };
	return schemaWords;
}

/** Whether `value` at `path` is its field's own schema value outside free-form data, which redaction keeps. */
export function keptSchemaValue(
	path: readonly (string | number)[],
	value: string,
): boolean {
	if (path.some((k) => typeof k === "string" && FREE_FIELDS.has(k)))
		return false;
	const key = [...path].reverse().find((k) => typeof k === "string") ?? "";
	return !!words().values.get(String(key))?.has(value);
}

/** `obj`'s entries with each key scrubbed unless `keep` says it is a schema name; clashes stay apart. */
function scrubKeys(
	entries: [string, unknown][],
	all: readonly string[],
	keep: (k: string) => boolean,
	onChange: () => void,
): [string, unknown][] {
	const taken = new Set<string>();
	return entries.map(([k, v]) => {
		let out = keep(k) ? k : scrub(k, all);
		if (out !== k) onChange();
		for (let n = 2; taken.has(out); n++) out = `${scrub(k, all)} ${n}`;
		taken.add(out);
		return [out, v];
	});
}

/**
 * The event with every exact secret value replaced inside its strings and its keys. A field's own
 * schema values (a `kind`, a `state`) and schema field names are kept outside free-form data, so
 * redaction cannot change an event's shape (#1180 §3.3). The same object when none occurs.
 */
export function redactEvent<T>(event: T, secrets: readonly string[]): T {
	if (!secrets.length) return event;
	const all = forms(secrets);
	const { values, fields } = words();
	let changed = false;
	const touched = () => {
		changed = true;
	};
	const walk = (v: unknown, key: string, free: boolean): unknown => {
		if (typeof v === "string") {
			if (!free && values.get(key)?.has(v)) return v;
			const out = scrub(v, all);
			if (out !== v) touched();
			return out;
		}
		if (Array.isArray(v)) return v.map((x) => walk(x, key, free));
		if (v && typeof v === "object")
			return Object.fromEntries(
				scrubKeys(
					Object.entries(v).map(([k, x]) => [
						k,
						walk(x, k, free || FREE_FIELDS.has(k)),
					]),
					all,
					(k) => !free && fields.has(k),
					touched,
				),
			);
		return v;
	};
	const out = walk(event, "", false);
	return changed ? (out as T) : event;
}

/**
 * A wire line with each secret replaced in its strings and keys, or as text when it does not
 * parse. A parsed line is always written back from what was parsed: `JSON.parse` keeps one of
 * a repeated member, so the original bytes may still hold a secret the walk never saw.
 */
export function redactLine(line: string, secrets: readonly string[]): string {
	if (!secrets.length) return line;
	const all = forms(secrets);
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return scrubUnparsed(line, all);
	}
	const walk = (v: unknown): unknown => {
		if (typeof v === "string") return scrub(v, all);
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object")
			return Object.fromEntries(
				scrubKeys(
					Object.entries(v).map(([k, x]) => [k, walk(x)]),
					all,
					() => false,
					() => undefined,
				),
			);
		return v;
	};
	return JSON.stringify(walk(parsed));
}

const ESCAPES = new Map([
	['"', '"'],
	["\\", "\\"],
	["/", "/"],
	["b", "\b"],
	["f", "\f"],
	["n", "\n"],
	["r", "\r"],
	["t", "\t"],
]);

/** `text` with its JSON string escapes decoded; `starts[i]` and `ends[i]` bound unit i's source. */
function decodeEscapes(text: string) {
	let out = "";
	const starts: number[] = [];
	const ends: number[] = [];
	for (let i = 0; i < text.length; ) {
		const next = text[i + 1] ?? "";
		const hex = text.slice(i + 2, i + 6);
		const [unit, len]: [string, number] =
			text[i] !== "\\"
				? [text[i] as string, 1]
				: next === "u" && /^[0-9a-fA-F]{4}$/.test(hex)
					? [String.fromCharCode(Number.parseInt(hex, 16)), 6]
					: [ESCAPES.get(next) ?? "\\", ESCAPES.has(next) ? 2 : 1];
		out += unit;
		starts.push(i);
		ends.push(i + len);
		i += len;
	}
	return { out, starts, ends };
}

/**
 * A line that does not parse, with every secret replaced as written or as its JSON escapes
 * decode (`\\u0073`), so a truncated record cannot spell one past the scrub. Overlaps merge.
 */
function scrubUnparsed(line: string, all: readonly string[]): string {
	const { out, starts, ends } = decodeEscapes(line);
	const hits: [number, number][] = [];
	const find = (
		text: string,
		s: string,
		at: (i: number) => [number, number],
	) => {
		for (let i = text.indexOf(s); i !== -1; i = text.indexOf(s, i + 1))
			hits.push(at(i));
	};
	for (const s of all.filter((x) => x.length)) {
		find(line, s, (i) => [i, i + s.length]);
		find(out, s, (i) => [
			starts[i] ?? 0,
			ends[i + s.length - 1] ?? line.length,
		]);
	}
	return masked(line, hits);
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

/** A released tail this long that begins a secret is masked; a shorter one is most often a word's end. */
const MASK_TAIL = 4;

/**
 * Scrubs secrets that may be split across a stream's pieces (stderr chunks, wire records,
 * events). A unit (a chunk, or a record's string values) is released only once each of its
 * channels has at least the longest secret's length minus one after it, or the stream ends;
 * a secret spanning pieces of one channel is replaced in every piece it touches.
 *
 * A unit released early (a flush, the end, or a channel gone quiet while others run on) has a
 * tail that begins a secret masked, and the tail is kept to catch the rest in a later piece.
 */
export class StreamScrubber {
	private readonly secrets: string[];
	private readonly keep: number;
	private units: { pieces: StreamPiece[]; marks: [number, number][][] }[] = [];
	/** Per channel, the released text that may begin a secret, read before its next piece. */
	private carry = new Map<string, string>();

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

	/** Everything still held, scrubbed, as when something else must go out before more comes. */
	flush(): string[][] {
		return this.release(true);
	}

	/** Everything still held, scrubbed; the stream is over. */
	end(): string[][] {
		const out = this.release(true);
		this.carry.clear();
		return out;
	}

	private release(ended: boolean): string[][] {
		const out: string[][] = [];
		const tails = new Map<string, string>();
		if (ended)
			for (const c of new Set(
				this.units.flatMap((u) => u.pieces.map(channelOf)),
			))
				tails.set(c, this.maskTail(c, this.span(c, null)));
		while (this.units.length) {
			const head = this.units[0] as (typeof this.units)[number];
			const channels = [...new Set(head.pieces.map(channelOf))];
			const spans = channels.map((c) => this.span(c, head));
			const short = channels.filter(
				(_, i) => (spans[i] as (typeof spans)[number]).after < this.keep,
			);
			// Channels with nothing after the head while the rest run on are released as at an end.
			const quiet =
				!ended &&
				short.length > 0 &&
				short.every((c) => this.span(c, head).after === 0) &&
				this.othersAfter(short) >= this.keep;
			if (!ended && short.length && !quiet) break;
			for (const [i, c] of channels.entries()) {
				const span = spans[i] as (typeof spans)[number];
				for (const secret of this.secrets)
					for (
						let at = span.text.indexOf(secret);
						at !== -1 && at < span.headLen;
						at = span.text.indexOf(secret, at + 1)
					)
						this.mark(c, at - span.pre, at - span.pre + secret.length);
				if (quiet && short.includes(c)) tails.set(c, this.maskTail(c, span));
			}
			this.units.shift();
			for (const c of channels) this.carry.delete(c);
			out.push(
				head.pieces.map((p, i) => masked(textOf(p), head.marks[i] ?? [])),
			);
		}
		for (const [c, tail] of tails) if (tail) this.carry.set(c, tail);
		return out;
	}

	/** Masks the longest end of `span` that begins a secret when it is long enough; returns that end. */
	private maskTail(c: string, span: ReturnType<typeof this.span>): string {
		let tail = "";
		let of = "";
		for (const s of this.secrets)
			for (
				let n = Math.min(s.length - 1, span.text.length);
				n > tail.length;
				n--
			)
				if (span.text.endsWith(s.slice(0, n))) {
					tail = s.slice(0, n);
					of = s;
					break;
				}
		if (tail && tail.length >= Math.min(MASK_TAIL, of.length - 1))
			this.mark(
				c,
				span.text.length - tail.length - span.pre,
				span.text.length - span.pre,
			);
		return tail;
	}

	/** How much held text of channels other than `short` follows the head unit. */
	private othersAfter(short: readonly string[]): number {
		return this.units
			.slice(1)
			.flatMap((u) => u.pieces)
			.filter((p) => !short.includes(channelOf(p)))
			.reduce((n, p) => n + textOf(p).length, 0);
	}

	/**
	 * Channel `c`'s carried and held text, how much of it the head unit (with the carry) holds,
	 * and how much follows; `pre` is the carry's length. With no head, all of it.
	 */
	private span(c: string, head: (typeof this.units)[number] | null) {
		const carried = this.carry.get(c) ?? "";
		const text =
			carried +
			this.units
				.flatMap((u) => u.pieces.filter((p) => channelOf(p) === c).map(textOf))
				.join("");
		const headLen = head
			? carried.length +
				head.pieces
					.filter((p) => channelOf(p) === c)
					.reduce((n, p) => n + textOf(p).length, 0)
			: text.length;
		return { text, headLen, after: text.length - headLen, pre: carried.length };
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

	/** Every record still held, scrubbed, before a record that must go out now. */
	flush(): T[] {
		return this.rebuild(this.stream.flush());
	}

	/** Every record still held, scrubbed; no more come. */
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
