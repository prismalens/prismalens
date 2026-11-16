// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export { pastedMarkdown } from "@/lib/markdown";
// Everything the composer runs that needs the editor library, in one chunk that loads after
// the box paints (#1101 category 12). Reach it through `editorKit()` once an editor exists.
export { ChipView } from "./ChipView";
export {
	chipDeleteKey,
	chipNode,
	findText,
	insertChips,
	lineEdge,
	patchFileChip,
	pickInto,
	replaceChip,
	selectedChip,
	triggerAt,
} from "./commands";
export { EditorHost } from "./EditorHost";
export { fenceEnter, pasteLines } from "./markdown";
