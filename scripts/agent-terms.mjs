#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Which runs each agent's sign-in paths may start, read from the agent registry (#1252).
 *
 *   agent-terms.mjs [agent]  each path: verdict, clause, URL, read date, gaps
 *   agent-terms.mjs check    fetches every source; exit 1 naming each whose quoted clause is gone
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
	]);
}

const ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Text as a reader compares it: scripts, tags, links, entities, curly quotes, code marks and spacing made plain. */
export function plain(text) {
	return text
		.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCharCode(parseInt(n, 16)),
		)
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[`*]/g, "")
		.replace(/\s+/g, " ")
		.replace(/\s+([,.;:!?)])/g, "$1");
}

/** A GitHub blob page renders its Markdown; the raw file holds the text as quoted. */
export const rawUrl = (url) =>
	url.replace(
		/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
		"https://raw.githubusercontent.com/$1/",
	);

/** No body text once head, script, style and noscript go, or only a no-JavaScript notice: a shell, so it can't be judged. */
const NO_JS =
	/^[^.]*\b(enable|turn on|requires?)\b[^.]*\bjavascript\b[^.]*\.?$/i;
const pageOf = (raw) => {
	const body = plain(
		raw.replace(/<(head|title|noscript)\b[\s\S]*?<\/\1>/gi, " "),
	).trim();
	return { text: plain(raw), shell: !body || NO_JS.test(body) };
};

/** Each distinct source: `present`, `changed` (its clause is gone), or `unreadable`. */
export async function checkSources(agents, fetchText) {
	const seen = new Map();
	for (const { id, auth } of agents)
		for (const m of auth.methods ?? [])
			for (const s of [m.terms.source, m.terms.against].filter(Boolean)) {
				const key = `${s.url}\n${s.clause}`;
				if (!seen.has(key)) seen.set(key, { at: `${id}.${m.id}`, ...s });
			}
	const pages = new Map();
	const results = [];
	for (const s of seen.values()) {
		if (!pages.has(s.url))
			pages.set(
				s.url,
				fetchText(rawUrl(s.url)).then(pageOf, (e) => ({ error: String(e) })),
			);
		const page = await pages.get(s.url);
		results.push({
			...s,
			state: page.error
				? "unreadable"
				: page.text.includes(plain(s.clause))
					? "present"
					: page.shell
						? "unreadable"
						: "changed",
		});
	}
	return results;
}

async function fetchText(url) {
	const res = await fetch(url, {
		headers: { "user-agent": "prismalens-terms-check" },
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.text();
}

async function main(args) {
	const agents = await loadAgents();
	if (args[0] === "check") {
		const results = await checkSources(agents, fetchText);
		for (const r of results)
			console.log(`${r.state.padEnd(10)} ${r.at}  ${r.url}`);
		const changed = results.filter((r) => r.state === "changed");
		for (const r of changed)
			console.error(`clause gone, re-read it: ${r.at} ${r.url} "${r.clause}"`);
		return changed.length ? 1 : 0;
	}
	for (const l of termsLines(agents, args[0])) console.log(l);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	process.exit(await main(process.argv.slice(2)));
