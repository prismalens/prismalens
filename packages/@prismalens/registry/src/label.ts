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
}

/** Why the PR needs the operator's label; empty when it doesn't, or when it has it. */
export function labelProblems(i: LabelInput): string[] {
	if (i.labels.includes(i.label)) return [];
	const out: string[] = [];
	for (const f of i.changed)
		if (
			f !== i.ratchet &&
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
	return out.map(
		(p) =>
			`${p}. Fix: undo it, or ask the operator to add the "${i.label}" label.`,
	);
}
