// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"thread.row": "thread";
		"thread.header": "thread";
		"thread.result": "thread";
	}
}

/** A sidebar row: ⋯ on hover or focus, and right-click, with the same rows (sheet §1). */
export const threadRow = defineSurface({
	id: "thread.row",
	label: "Thread actions",
	menus: {
		context: [
			"thread.rename",
			"thread.nameAgain",
			"thread.pin",
			"thread.archive",
			"-",
			"thread.settle",
		],
		more: [
			"thread.rename",
			"thread.nameAgain",
			"thread.pin",
			"thread.archive",
			"-",
			"thread.settle",
		],
	},
	states: { default: "thread-menu", phone: "thread-list-collapsed" },
	marks: ["status", "agent", "children"],
});

/** The thread page's header ⋯ (sheet §2); a phone folds the header's own controls in first. */
export const threadHeader = defineSurface({
	id: "thread.header",
	label: "Thread actions",
	menus: {
		more: [
			"thread.pr",
			"thread.details",
			"thread.changes",
			"thread.files",
			"thread.browser",
			"thread.kind",
			"thread.statusBox",
			"-",
			"thread.notify",
			"thread.mute",
			"thread.schedule",
			"-",
			"thread.rename",
			"thread.nameAgain",
			"thread.settle",
			"-",
			"thread.archive",
		],
	},
	states: { default: "thread-header-menu", phone: "thread-header-menu" },
	marks: ["status"],
});

/** A thread in the Ctrl K palette: Alt+Enter lists these. */
export const threadResult = defineSurface({
	id: "thread.result",
	label: "Thread actions",
	menus: {
		more: [
			"thread.open",
			"thread.panel",
			"thread.settle",
			"thread.transcript",
			"thread.link",
			"thread.pin",
			"thread.archive",
		],
	},
	states: { default: "thread-result-menu", phone: "thread-result-menu" },
	marks: ["status"],
});
