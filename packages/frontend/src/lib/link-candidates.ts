// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type LinkCandidate,
	type LinkTarget,
	RESOLVE_LINKS_MAX,
} from "@prismalens/contracts";

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]*[^\s<>()[\]"'`.,;:!?]/g;
/** `src/a.ts`, `./a/b.py:12`, `pkg/x.go:3-9`: a path needs a folder and an extension. */
const PATH_RE =
	/(?<![\w/.-])(?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,10}(?::\d+(?:-\d+)?)?(?![\w/])/g;
const UUID_RE =
	/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const INCIDENT_RE = /\bINC-\d+\b/g;
const FENCE_RE = /```[\s\S]*?(?:```|$)/g;

/**
 * What in one message could open somewhere (#1024): paths, URLs, thread ids and
 * incident numbers, each once, in the order they first appear. Fenced code is skipped.
 */
export function linkCandidates(text: string): LinkCandidate[] {
	const prose = text.replace(FENCE_RE, (m) => " ".repeat(m.length));
	const found: { at: number; c: LinkCandidate }[] = [];
	const seen = new Set<string>();
	const add = (at: number, c: LinkCandidate) => {
		const key = `${c.kind}:${c.text}`;
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ at, c });
	};
	const urls = Array.from(prose.matchAll(URL_RE));
	for (const m of urls) add(m.index, { kind: "url", text: m[0] });
	// A URL's own path is not a file path.
	const rest = urls.reduce(
		(s, m) =>
			s.slice(0, m.index) +
			" ".repeat(m[0].length) +
			s.slice(m.index + m[0].length),
		prose,
	);
	for (const m of Array.from(rest.matchAll(PATH_RE)))
		add(m.index, { kind: "path", text: m[0] });
	for (const m of Array.from(rest.matchAll(UUID_RE)))
		add(m.index, { kind: "thread", text: m[0].toLowerCase() });
	for (const m of Array.from(rest.matchAll(INCIDENT_RE)))
		add(m.index, { kind: "incident", text: m[0] });
	return found
		.sort((a, b) => a.at - b.at)
		.map((f) => f.c)
		.slice(0, RESOLVE_LINKS_MAX);
}

/** The resolved targets by candidate text; unresolved candidates are left out. */
export function targetsByText(
	candidates: readonly LinkCandidate[],
	targets: readonly (LinkTarget | null)[],
): Map<string, LinkTarget> {
	const map = new Map<string, LinkTarget>();
	candidates.forEach((c, i) => {
		const t = targets[i];
		if (t) map.set(c.text, t);
	});
	return map;
}

export const LINK_HREF = "#pl-link:";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The message's Markdown with each resolved candidate made a link to `#pl-link:<text>`,
 * so the renderer can open it in place. Fenced code and existing links are left alone.
 */
export function linkify(
	text: string,
	resolved: ReadonlyMap<string, LinkTarget>,
): string {
	const keys = Array.from(resolved.keys()).filter((k) => !/^https?:/.test(k));
	if (!keys.length) return text;
	keys.sort((a, b) => b.length - a.length);
	const any = keys.map(escapeRe).join("|");
	// A backticked candidate, or a bare one not already inside a link or a URL.
	const re = new RegExp(
		`\`(${any})\`|(?<![\\w/.:#\\[-])(${any})(?![\\w/]|\\]\\()`,
		"g",
	);
	return text
		.split(/(```[\s\S]*?(?:```|$)|\[[^\]]*\]\([^)]*\))/)
		.map((part, i) =>
			i % 2 === 1
				? part
				: part.replace(
						re,
						(m, code: string | undefined, bare: string | undefined) => {
							const key = code ?? bare ?? m;
							return `[${m}](${LINK_HREF}${encodeURIComponent(key)})`;
						},
					),
		)
		.join("");
}

/** The candidate text a `#pl-link:` href carries, else null. */
export function linkKey(href: string | undefined): string | null {
	if (!href?.startsWith(LINK_HREF)) return null;
	try {
		return decodeURIComponent(href.slice(LINK_HREF.length));
	} catch {
		return null;
	}
}

/** A URL the desktop app's own browser view should open: this machine, or one the agent served. */
export function isLocalUrl(href: string): boolean {
	try {
		const host = new URL(href).hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "[::1]" ||
			host === "0.0.0.0" ||
			host.endsWith(".localhost")
		);
	} catch {
		return false;
	}
}
