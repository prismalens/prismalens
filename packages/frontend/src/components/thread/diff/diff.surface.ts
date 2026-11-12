// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"diff.file": "diffFile";
	}
}

/** The open file's header in the diff pane: ⋯ and right-click list the same rows. */
export const diffFile = defineSurface({
	id: "diff.file",
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
