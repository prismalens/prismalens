// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** A sidebar row: ⋯ on hover or focus, and right-click, with the same rows (sheet §1). */
export const threadRow = defineSurface({
	id: "thread.row",
	label: "Thread actions",
	menus: {
		context: [
			"thread.rename",
			"thread.nameAgain",
			"thread.pin",
			"-",
			"thread.fork",
			"thread.aside",
			"thread.worktree",
			"-",
			"thread.link",
			"thread.transcript",
			"-",
			"thread.settle",
			"thread.archive",
		],
		more: [
			"thread.rename",
			"thread.nameAgain",
			"thread.pin",
			"-",
			"thread.fork",
			"thread.aside",
			"thread.worktree",
			"-",
			"thread.link",
			"thread.transcript",
			"-",
			"thread.settle",
			"thread.archive",
		],
	},
	states: { default: "thread-menu", phone: "thread-list-started" },
	marks: ["status", "agent", "startedBy"],
});

/** The thread page's header ⋯: a phone folds the header's own controls in first, then the row's full set with the same keys (sheet §2, #1101 bar 20.1). */
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
			"thread.pin",
			"-",
			"thread.fork",
			"thread.aside",
			"thread.worktree",
			"-",
			"thread.link",
			"thread.transcript",
			"-",
			"thread.settle",
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
