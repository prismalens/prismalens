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
	/** JSON budget files whose numbers may only fall without the label, at the base and the head. */
	readonly budgets?: readonly { path: string; base: string; head: string }[];
}

/** A budget file's numeric keys; an unreadable file reads as having none. */
function numbers(json: string): Map<string, number> {
	try {
		const o = JSON.parse(json) as Record<string, unknown>;
		return new Map(
			Object.entries(o).filter(
				(e): e is [string, number] => typeof e[1] === "number",
			),
		);
	} catch {
		return new Map();
	}
}

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
	const base = parseTsv(i.baseTsv).facts;
	for (const [k, n] of parseTsv(i.headTsv).facts) {
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
			if (w === undefined) out.push(`${k} is a new budget in ${b.path}`);
			else if (n > w) out.push(`${k} rose from ${w} to ${n} in ${b.path}`);
		}
		for (const k of was.keys())
			if (!now.has(k)) out.push(`${k} was removed from ${b.path}`);
	}
	return out.map(
		(p) =>
			`${p}. Fix: undo it, or ask the operator to add the "${i.label}" label.`,
	);
}
