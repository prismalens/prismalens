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
		return scrub(line, all);
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
