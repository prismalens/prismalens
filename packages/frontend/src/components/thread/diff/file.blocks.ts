// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A file shown read-only: the Files pane, or a file the run read at its commit. */
export interface FileExcerptData {
	/** The path the agent and the editor use. */
	path: string;
	contents: string;
	/** The cited line or range, if any. */
	line?: number;
	end?: number;
}

/** One change in a diff: Copy takes its new text. */
export interface DiffHunkData {
	path: string;
	/** The change's new lines, empty for a pure deletion. */
	text: string;
	line: number;
	end: number;
}

/** Lines `start` to `end` of a file's text, 1-based. */
export const fileLines = (contents: string, start: number, end: number) =>
	contents
		.split("\n")
		.slice(start - 1, end)
		.join("\n");

export const fileExcerptBlock = define.block<FileExcerptData>({
	id: "file.excerpt",
	label: "File",
	copyLabel: "Copy file",
	text: (d) => d.contents,
	source: (d) => ({ kind: "file", path: d.path, line: d.line, end: d.end }),
	marks: ["code"],
	states: { default: "block-file-excerpt", phone: "block-file-excerpt" },
});

export const diffHunkBlock = define.block<DiffHunkData>({
	id: "diff.hunk",
	label: "Change",
	copyLabel: "Copy new text",
	text: (d) => d.text,
	source: (d) => ({ kind: "file", path: d.path, line: d.line, end: d.end }),
	marks: [],
	states: { default: "block-diff-hunk", phone: "block-diff-hunk" },
});
