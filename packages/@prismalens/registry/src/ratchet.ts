// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The ratchet: one sorted TSV, one `file<TAB>rule<TAB>count` fact per line, so
 * parallel fixes don't collide. A count may only fall, and a stale line fails
 * until it is lowered; raising one needs the operator's label in CI.
 */

export type Facts = ReadonlyMap<string, number>;

const key = (file: string, rule: string) => `${file}\t${rule}`;

export const HEADER =
	"# file\trule\tcount (only lowered; a raise needs the operator's label)";

export function parseTsv(text: string): {
	facts: Map<string, number>;
	problems: string[];
} {
	const facts = new Map<string, number>();
	const problems: string[] = [];
	const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
	lines.forEach((line, i) => {
		const [file, rule, count, ...rest] = line.split("\t");
		const n = Number(count);
		if (!file || !rule || rest.length || !Number.isInteger(n) || n <= 0) {
			problems.push(
				`ratchet line ${i + 1} is not "file<TAB>rule<TAB>count>0": ${line}`,
			);
			return;
		}
		const k = key(file, rule);
		if (facts.has(k)) problems.push(`ratchet lists ${file} ${rule} twice`);
		facts.set(k, n);
	});
	const sorted = [...lines].sort();
	if (lines.some((l, i) => l !== sorted[i]))
		problems.push("ratchet lines are not sorted");
	return { facts, problems };
}

export function formatTsv(facts: Facts): string {
	const lines = Array.from(facts)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${k}\t${n}`)
		.sort();
	return `${[HEADER, ...lines].join("\n")}\n`;
}

/** Adds one hit of `rule` in `file`. */
export function bump(
	facts: Map<string, number>,
	file: string,
	rule: string,
	by = 1,
) {
	const k = key(file, rule);
	facts.set(k, (facts.get(k) ?? 0) + by);
}

/** Text patterns counted per file, beside the lint rules. */
export const TEXT_RULES: readonly {
	readonly rule: string;
	readonly pattern: RegExp;
}[] = [
	{ rule: "biome-ignore", pattern: /biome-ignore/g },
	{ rule: "as-never", pattern: /\bas never\b/g },
];

export function countText(
	facts: Map<string, number>,
	file: string,
	text: string,
) {
	for (const { rule, pattern } of TEXT_RULES) {
		const n = text.match(pattern)?.length ?? 0;
		if (n) bump(facts, file, rule, n);
	}
}

/** Every rise and every stale line, each with its fix. */
export function compare(listed: Facts, actual: Facts): string[] {
	const out: string[] = [];
	for (const [k, n] of actual) {
		const was = listed.get(k) ?? 0;
		if (n > was) {
			const [file, rule] = k.split("\t");
			out.push(
				`${file}: ${rule} rose from ${was} to ${n}. ${TEXT_RULES.some((t) => t.rule === rule) ? "Fix the cause instead of suppressing or casting it" : "Fix the new hit as its lint message says"}; a raise needs the operator's label on the PR.`,
			);
		}
	}
	for (const [k, was] of listed) {
		const n = actual.get(k) ?? 0;
		if (n < was) {
			const [file, rule] = k.split("\t");
			out.push(
				`${file}: ${rule} fell from ${was} to ${n}. Lower the ratchet: run \`pnpm registry ratchet --write\` and commit it.`,
			);
		}
	}
	return out;
}

/** The lint rules' hits from Biome's JSON report: plugin messages that start `[L<n>]`. */
export function lintFacts(
	report: {
		diagnostics: readonly {
			category?: string;
			message?: string;
			location?: { path?: string };
		}[];
	},
	toFile: (path: string) => string,
	facts: Map<string, number>,
) {
	for (const d of report.diagnostics) {
		const rule =
			d.category === "plugin"
				? d.message?.match(/^\[(L\d+)\]/)?.[1]
				: undefined;
		if (rule && d.location?.path) bump(facts, toFile(d.location.path), rule);
	}
}
