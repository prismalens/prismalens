// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, ExternalLink, FileText, Paperclip, Undo2 } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";

/** One changed file in the diff pane. Revert asks first, as its button does. */
export interface DiffFileCtx {
	viewFile: () => void;
	openEditor: () => void;
	copyPath: () => void;
	attach: () => void;
	revert: () => void;
	facts: Facts<"revertable" | "busy">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		diffFile: DiffFileCtx;
	}
	interface ObjectStates {
		diffFile: "revertable" | "busy";
	}
	interface ActionObjects {
		"diffFile.view": "diffFile";
		"diffFile.openEditor": "diffFile";
		"diffFile.copyPath": "diffFile";
		"diffFile.attach": "diffFile";
		"diffFile.revert": "diffFile";
	}
}

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
