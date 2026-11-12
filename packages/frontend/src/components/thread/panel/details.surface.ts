// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"thread.details": "details";
	}
}

/** The details card: right-click and the palette list its one git action and its openers. */
export const threadDetails = defineSurface({
	id: "thread.details",
	label: "Details actions",
	menus: {
		context: [
			"details.push",
			"details.createPr",
			"details.fixChecks",
			"details.resolveConflicts",
			"details.markReady",
			"details.viewPr",
			"-",
			"details.openFolder",
			"details.openTerminal",
		],
		/** The folder button's chevron: the other openers. */
		more: ["details.openTerminal"],
	},
	states: {
		default: "details-full",
		phone: "details-full",
		actions: "details-actions",
		children: "details-children",
	},
	marks: ["status", "agent", "branch", "changeRequest", "children"],
});
