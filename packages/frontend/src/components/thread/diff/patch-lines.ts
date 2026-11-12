// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** One hunk of a one-file patch: its header as git wrote it and where its first change sits. */
export interface PatchHunk {
	header: string;
	/** The change's last line: where its Revert bar sits, after the change. */
	side: "additions" | "deletions";
	line: number;
	additions: number;
	deletions: number;
}

export interface PatchLines {
	hunks: PatchHunk[];
	/** Line text by number, on each side, for the lines the patch carries. */
	old: Map<number, string>;
	new: Map<number, string>;
	/** A binary, mode-only, added or deleted file: no hunk of it can be reverted alone. */
	wholeFileOnly: boolean;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Reads a one-file unified patch (#1101 category 16). */
export function patchLines(patch: string): PatchLines {
	const out: PatchLines = {
		hunks: [],
		old: new Map(),
		new: new Map(),
		wholeFileOnly:
			/^(new file mode|deleted file mode|old mode|Binary files|GIT binary patch)/m.test(
				patch,
			),
	};
	let o = 0;
	let n = 0;
	let hunk: PatchHunk | null = null;
	for (const raw of patch.split("\n")) {
		const m = HUNK.exec(raw);
		if (m) {
			o = Number(m[1]);
			n = Number(m[2]);
			hunk = {
				header: raw,
				side: "additions",
				line: 0,
				additions: 0,
				deletions: 0,
			};
			out.hunks.push(hunk);
			continue;
		}
		if (!hunk) continue;
		const mark = raw[0];
		const text = raw.slice(1);
		if (mark === " ") {
			out.old.set(o++, text);
			out.new.set(n++, text);
		} else if (mark === "-") {
			if (!hunk.additions) Object.assign(hunk, { side: "deletions", line: o });
			hunk.deletions++;
			out.old.set(o++, text);
		} else if (mark === "+") {
			Object.assign(hunk, { side: "additions", line: n });
			hunk.additions++;
			out.new.set(n++, text);
		}
	}
	return out;
}
