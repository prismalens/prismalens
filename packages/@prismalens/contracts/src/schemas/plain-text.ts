// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Markdown as one plain line, for titles, peeks and palette excerpts (#1101
 * bar 1.6 and 19.2): emphasis, code ticks, links and headings drop their marks.
 */
export function inlinePlain(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`+([^`]*)`+/g, "$1")
		.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
		.replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=$|[\s).,:;!?])/g, "$1$2")
		.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The last line of prose in an agent's text: fenced code and JSON-shaped
 * lines are skipped, so a reply that ends in a code block shows the sentence
 * before it. Null when no prose is left.
 */
export function lastPlainLine(text: string | null | undefined): string | null {
	if (!text) return null;
	const prose = text.replace(
		/^\s*(```|~~~)[\s\S]*?(^\s*\1\s*$|$(?![\s\S]))/gm,
		"",
	);
	const lines = prose
		.split("\n")
		.map((l) => l.trim())
		.filter(
			(l) =>
				l &&
				!/^[{}[\]]/.test(l) &&
				!/^"[^"]*"\s*:/.test(l) &&
				!/^(```|~~~|---+|\|)/.test(l),
		);
	for (let i = lines.length - 1; i >= 0; i--) {
		const plain = inlinePlain(lines[i] as string);
		if (/[\p{L}\p{N}]/u.test(plain)) return plain;
	}
	return null;
}
