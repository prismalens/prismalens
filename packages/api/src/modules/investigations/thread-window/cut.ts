// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	CanonicalEventSchema,
	type CutField,
} from "@prismalens/contracts";

/** A page's string leaves keep this many characters; the rest is read through `eventFull`. */
export const LEAF_CHARS = 2048;
/** A structured field (`args`, `input`) over this many bytes is left out whole. */
const OBJECT_BYTES = 8 * 1024;
/** An event still over this after its leaves are cut is cut harder, then stubbed (#1101 cat 12). */
export const EVENT_BYTES = 64 * 1024;

const STRUCTURED = new Set(["args", "input"]);

function cutValue(
	value: unknown,
	path: string,
	cuts: CutField[],
	opts: { leaf: number; items: number | null; structured: boolean },
): unknown {
	if (typeof value === "string") {
		if (value.length <= opts.leaf) return value;
		cuts.push({ path, bytes: value.length });
		return value.slice(0, opts.leaf);
	}
	if (Array.isArray(value)) {
		const kept =
			opts.items !== null && value.length > opts.items
				? (cuts.push({ path, bytes: JSON.stringify(value).length }),
					value.slice(0, opts.items))
				: value;
		return kept.map((v, i) => cutValue(v, `${path}.${i}`, cuts, opts));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			const at = path ? `${path}.${k}` : k;
			if (opts.structured && STRUCTURED.has(k) && v && typeof v === "object") {
				const size = JSON.stringify(v).length;
				if (size > OBJECT_BYTES) {
					cuts.push({ path: at, bytes: size });
					out[k] = Array.isArray(v) ? [] : {};
					continue;
				}
			}
			out[k] = cutValue(v, at, cuts, opts);
		}
		return out;
	}
	return value;
}

function attempt(
	event: CanonicalEvent,
	opts: { leaf: number; items: number | null; structured: boolean },
): { event: CanonicalEvent; cut: CutField[] } | null {
	const cut: CutField[] = [];
	const next = cutValue(event, "", cut, opts);
	if (cut.length === 0) return { event, cut };
	// A cut must still be the event's shape; a field the schema bounds below is never cut.
	const parsed = CanonicalEventSchema.safeParse(next);
	return parsed.success ? { event: parsed.data, cut } : null;
}

/**
 * The event a page carries: leaves over {@link LEAF_CHARS} cut, then, while it is
 * over {@link EVENT_BYTES}, arrays cut to 50 and leaves to 256, then a stub. Every
 * cut is listed so the client never mistakes a preview for the record.
 */
export function cutForPage(event: CanonicalEvent): {
	event: CanonicalEvent;
	cut?: CutField[];
} {
	const tries = [
		{ leaf: LEAF_CHARS, items: null, structured: true },
		{ leaf: 256, items: 50, structured: true },
		{ leaf: 64, items: 0, structured: true },
	];
	let best: { event: CanonicalEvent; cut: CutField[] } | null = null;
	for (const opts of tries) {
		const got = attempt(event, opts);
		if (!got) continue;
		best = got;
		if (JSON.stringify(got.event).length <= EVENT_BYTES) break;
	}
	if (!best || best.cut.length === 0) return { event };
	const stubbed = JSON.stringify(best.event).length > EVENT_BYTES;
	return {
		event: best.event,
		cut: stubbed
			? [{ path: "*", bytes: JSON.stringify(event).length }]
			: best.cut,
	};
}
