#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which runs each agent's sign-in paths may start, read from the agent registry (#1252).
 *
 *   agent-terms.mjs [agent]           each path: verdict, clause, URL, read date, gaps
 *   agent-terms.mjs stale [--days N]  every source by read date; exit 1 naming each older than N days (90)
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400_000;

/** Every agent's sign-in data, by its launch id. */
export async function loadAgents() {
	const { agents } = await import(
		pathToFileURL(join(ROOT, "packages/@prismalens/providers/src/agents.ts"))
			.href
	);
	return agents().map((a) => ({ id: a.launch, auth: a.auth ?? {} }));
}

const quote = (s) => `"${s.clause}" ${s.url} (read ${s.readOn})`;

/** The answer for each agent, or the one named. */
export function termsLines(agents, only) {
	const picked = only ? agents.filter((a) => a.id === only) : agents;
	if (only && !picked.length) throw new Error(`no agent ${only}`);
	return picked.flatMap(({ id, auth }) => [
		id,
		...(auth.methods ?? []).flatMap((m) => [
			`  ${m.id} (${m.label}): ${m.terms.runs}`,
			`    ${quote(m.terms.source)}`,
			...(m.terms.against ? [`    against: ${quote(m.terms.against)}`] : []),
			...(m.terms.gaps?.length
				? [`    not read: ${m.terms.gaps.join("; ")}`]
				: []),
		]),
		...(auth.precedence
			? [
					`  precedence: ${auth.precedence.first} first, ${quote(auth.precedence.source)}`,
				]
			: []),
	]);
}

/** Every source with its read date, oldest first, and those older than `days` on `today`. */
export function staleSources(agents, today, days) {
	const all = agents.flatMap(({ id, auth }) => [
		...(auth.methods ?? []).flatMap((m) =>
			[m.terms.source, m.terms.against]
				.filter(Boolean)
				.map((s) => ({ at: `${id}.${m.id}`, ...s })),
		),
		...(auth.precedence
			? [{ at: `${id}.precedence`, ...auth.precedence.source }]
			: []),
	]);
	all.sort(
		(a, b) => a.readOn.localeCompare(b.readOn) || a.at.localeCompare(b.at),
	);
	const cutoff = today.getTime() - days * DAY;
	return { all, stale: all.filter((s) => Date.parse(s.readOn) < cutoff) };
}

async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: { days: { type: "string", default: "90" } },
	});
	const agents = await loadAgents();
	if (positionals[0] === "stale") {
		const days = Number(values.days);
		const { all, stale } = staleSources(agents, new Date(), days);
		for (const s of all) console.log(`${s.readOn}  ${s.at}  ${s.url}`);
		for (const s of stale)
			console.error(
				`older than ${days} days: ${s.at} ${s.url} (read ${s.readOn})`,
			);
		return stale.length ? 1 : 0;
	}
	for (const l of termsLines(agents, positionals[0])) console.log(l);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	process.exit(await main());
