// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The details card: right-click and the palette list its one git action and its openers. */
export const threadDetails = defineSurface({
	id: "thread.details",
	object: "details",
	label: "Details actions",
	menus: {
		context: [
			"details.push",
			"details.createPr",
			"details.fixChecks",
			"details.resolveConflicts",
			"details.restoreBranch",
			"details.branchAndPush",
			"details.reread",
			"details.markReady",
			"details.viewPr",
			"-",
			"details.openFolder",
			"details.openTerminal",
		],
		/** The folder button's chevron: every opener, the default ticked (#1176). */
		more: [
			"details.openIn.vscode",
			"details.openIn.cursor",
			"details.openIn.zed",
			"details.openIn.jetbrains",
			"details.openIn.sublime",
			"details.openIn.system",
			"-",
			"details.openTerminal",
			"-",
			"details.ownerDefault",
		],
	},
	states: {
		default: "details-full",
		phone: "details-full",
		actions: "details-actions",
		started: "details-started",
	},
	marks: [
		"status",
		"agent",
		"branch",
		"changeRequest",
		"startedBy",
		"gitState",
	],
});
