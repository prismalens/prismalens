// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { parseTsv } from "./ratchet.ts";

export interface LabelInput {
	/** Repo-relative paths the PR changes. */
	readonly changed: readonly string[];
	/** Path prefixes only the operator's label may change: kernel, guards, plugins, ratchet. */
	readonly protectedPaths: readonly string[];
	/** The ratchet TSV's repo-relative path, and its text at the base and the head. */
	readonly ratchet: string;
	readonly baseTsv: string;
	readonly headTsv: string;
	readonly labels: readonly string[];
	readonly label: string;
	/** Files the PR renames, old to new, as the ratchet's rows name them: a row follows its file. */
	readonly renames?: ReadonlyMap<string, string>;
	/** JSON budget files whose numbers may only fall without the label, at the base and the head. */
	readonly budgets?: readonly { path: string; base: string; head: string }[];
}

/**
 * A budget file's numbers by key path; unreadable reads as none. The key is the path as JSON,
 * so a nested `bytes` and a literal `"linux-x64.bytes"` key stay two budgets.
 */
function numbers(json: string): Map<string, number> {
	const out = new Map<string, number>();
	const walk = (v: unknown, at: string[]) => {
		if (typeof v === "number") out.set(JSON.stringify(at), v);
		else if (v && typeof v === "object" && !Array.isArray(v))
			for (const [k, c] of Object.entries(v)) walk(c, [...at, k]);
	};
	try {
		walk(JSON.parse(json), []);
	} catch {
		return new Map();
	}
	return out;
}

/** The dotted form a message names a budget by (`linux-x64.bytes`). */
const dotted = (key: string) => (JSON.parse(key) as string[]).join(".");

/** Why the PR needs the operator's label; empty when it doesn't, or when it has it. */
export function labelProblems(i: LabelInput): string[] {
	if (i.labels.includes(i.label)) return [];
	const out: string[] = [];
	const budgets = i.budgets ?? [];
	for (const f of i.changed)
		if (
			f !== i.ratchet &&
			!budgets.some((b) => b.path === f) &&
			i.protectedPaths.some(
				(p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`),
			)
		)
			out.push(`${f} is a registry guard path`);
	const base = new Map<string, number>(
		Array.from(parseTsv(i.baseTsv).facts, ([k, n]) => {
			const [file = "", rule] = k.split("\t");
			return [`${i.renames?.get(file) ?? file}\t${rule}`, n] as const;
		}),
	);
	const head = parseTsv(i.headTsv);
	// A duplicate record keeps only its last count, which can hide a raise.
	for (const p of head.problems) out.push(`${i.ratchet}: ${p}`);
	for (const [k, n] of head.facts) {
		const was = base.get(k) ?? 0;
		if (n > was)
			out.push(
				`${k.replace("\t", " ")} rose from ${was} to ${n} in ${i.ratchet}`,
			);
	}
	for (const b of budgets) {
		const was = numbers(b.base);
		const now = numbers(b.head);
		for (const [k, n] of now) {
			const w = was.get(k);
			if (w === undefined)
				out.push(`${dotted(k)} is a new budget in ${b.path}`);
			else if (n > w)
				out.push(`${dotted(k)} rose from ${w} to ${n} in ${b.path}`);
		}
		for (const k of was.keys())
			if (!now.has(k)) out.push(`${dotted(k)} was removed from ${b.path}`);
	}
	return out.map(
		(p) =>
			`${p}. Fix: undo it, or ask the operator to add the "${i.label}" label.`,
	);
}
