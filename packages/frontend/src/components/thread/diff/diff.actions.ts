// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Copy,
	ExternalLink,
	FileDiff,
	FileText,
	MessageSquarePlus,
	MessageSquareQuote,
	Paperclip,
	Undo2,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** One changed file in the diff pane. Revert asks first, as its button does. */
export interface DiffFileCtx {
	/** A file-tree row: show its diff. */
	openDiff?: () => void;
	viewFile: () => void;
	openEditor: () => void;
	copyPath: () => void;
	attach: () => void;
	revert: () => void;
	facts: Facts<"revertable" | "busy" | "tree">;
}

/** The diffFile object: the context its actions run with and the states they test. */
export const diffFileObject = defineObject<
	DiffFileCtx,
	"revertable" | "busy" | "tree"
>("diffFile");

export const diffFileOpen = defineAction({
	id: "diffFile.open",
	label: "Open diff",
	icon: FileDiff,
	when: (f) => !!f.is?.tree,
	run: (c) => c.openDiff?.(),
});

export const diffFileView = defineAction({
	id: "diffFile.view",
	label: "View file",
	icon: FileText,
	run: (c) => c.viewFile(),
});

export const diffFileOpenEditor = defineAction({
	id: "diffFile.openEditor",
	label: "Open in editor",
	icon: ExternalLink,
	run: (c) => c.openEditor(),
});

export const diffFileCopyPath = defineAction({
	id: "diffFile.copyPath",
	label: "Copy path",
	icon: Copy,
	run: (c) => c.copyPath(),
});

export const diffFileAttach = defineAction({
	id: "diffFile.attach",
	label: "Attach to message",
	icon: Paperclip,
	run: (c) => c.attach(),
});

export const diffFileRevert = defineAction({
	id: "diffFile.revert",
	label: "Revert file",
	icon: Undo2,
	destructive: true,
	when: (f) => !!f.is?.revertable,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.revert(),
});

/** One line of the open diff, right-clicked or keyed with Shift+F10 (#1125). */
export interface DiffLineCtx {
	comment: () => void;
	quote: () => void;
	copy: () => void;
	openEditor: () => void;
	facts: Facts<never>;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		diffLine: DiffLineCtx;
	}
	interface ActionObjects {
		"diffLine.comment": "diffLine";
		"diffLine.quote": "diffLine";
		"diffLine.copy": "diffLine";
		"diffLine.openEditor": "diffLine";
	}
}

export const diffLineComment = defineAction({
	id: "diffLine.comment",
	label: "Comment",
	icon: MessageSquarePlus,
	run: (c) => c.comment(),
});

export const diffLineQuote = defineAction({
	id: "diffLine.quote",
	label: "Add to composer",
	icon: MessageSquareQuote,
	run: (c) => c.quote(),
});

export const diffLineCopy = defineAction({
	id: "diffLine.copy",
	label: "Copy line",
	icon: Copy,
	run: (c) => c.copy(),
});

export const diffLineOpenEditor = defineAction({
	id: "diffLine.openEditor",
	label: "Open in editor",
	icon: ExternalLink,
	run: (c) => c.openEditor(),
});
