// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"diff.file": "diffFile";
		"diff.tree": "diffFile";
		"diff.line": "diffLine";
	}
}

/** The open file's header in the diff pane: ⋯ and right-click list the same rows. */
export const diffFile = defineSurface({
	id: "diff.file",
	object: "diffFile",
	label: "File actions",
	menus: {
		context: [
			"diffFile.view",
			"diffFile.openEditor",
			"diffFile.copyPath",
			"diffFile.attach",
			"diffFile.revert",
		],
		more: [
			"diffFile.view",
			"diffFile.openEditor",
			"diffFile.copyPath",
			"diffFile.attach",
			"diffFile.revert",
		],
	},
	states: { default: "diff-file-menu", phone: "diff-file-menu" },
	marks: ["risk"],
});

const TREE_ROW = [
	"diffFile.open",
	"diffFile.view",
	"diffFile.openEditor",
	"-",
	"diffFile.copyPath",
	"diffFile.attach",
] as const;

/** A changed file in the diff's tree: right-click, Shift+F10 and the Menu key on its row. */
export const diffTree = defineSurface({
	id: "diff.tree",
	object: "diffFile",
	label: "File actions",
	menus: { context: TREE_ROW, more: TREE_ROW },
	states: { default: "diff-tree-menu", phone: "diff-tree-menu" },
	marks: ["risk"],
});

const LINE = [
	"diffLine.comment",
	"diffLine.quote",
	"-",
	"diffLine.copy",
	"diffLine.openEditor",
] as const;

/** A line of the open diff: right-click it, or Shift+F10 in the focused diff for its first line. */
export const diffLine = defineSurface({
	id: "diff.line",
	object: "diffLine",
	label: "Line actions",
	menus: { context: LINE, more: LINE },
	states: { default: "diff-line-menu", phone: "diff-line-menu" },
	marks: [],
});
