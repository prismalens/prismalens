// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `-n prod` and `--since 2h`: a flag and its value, never split across lines. */
function pairs(text: string): { at: number; text: string }[] {
	const words = text.split(/(\s+)/);
	const out: { at: number; text: string }[] = [];
	let at = 0;
	for (let i = 0; i < words.length; i++) {
		const w = words[i] ?? "";
		const gap = words[i + 1];
		const next = words[i + 2];
		const joined =
			/^-{1,2}[\w-]+$/.test(w) && gap === " " && next && !next.startsWith("-")
				? `${w} ${next}`
				: w;
		out.push({ at, text: joined });
		at += joined.length;
		if (joined !== w) i += 2;
	}
	return out;
}

/**
 * A shell command that wraps only at spaces between flag-value pairs (#1101); it copies
 * as written, since each pair keeps its own space.
 */
export function CommandText({ text }: { text: string }) {
	return pairs(text).map((p) =>
		/\S\s\S/.test(p.text) ? (
			<span key={p.at} className="whitespace-nowrap">
				{p.text}
			</span>
		) : (
			p.text
		),
	);
}
