// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

export const prChip = defineSurface({
	id: "pr.chip",
	label: "Change request actions",
	menus: {
		context: ["pr.openPanel", "pr.openHost", "-", "pr.copyLink", "pr.refresh"],
	},
	states: { default: "pr-row", phone: "pr-status-lines" },
	marks: ["changeRequest"],
});

/** Re-run waits on a host capability reaching the UI (#1122). */
export const checkRow = defineSurface({
	id: "check.row",
	label: "Check actions",
	menus: {
		context: ["check.toggleLog", "check.draftFix", "-", "check.openLog"],
	},
	states: { default: "pr-checks-tail", phone: "mr-pipeline" },
	marks: ["changeRequest"],
});
