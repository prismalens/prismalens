// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The alert page's actions; its list row places the same list, so the two never drift (#1127). */
const ENTRIES = [
	"alert.open",
	"alert.openIncident",
	"alert.correlate",
	"-",
	"alert.resolve",
	"-",
	"alert.copyPayload",
	"alert.copyLink",
] as const;

/** An alert page's band: its ⋯ and right-click. */
export const alertHeader = defineSurface({
	id: "alert.header",
	object: "alert",
	label: "Alert actions",
	menus: { context: ENTRIES, more: ENTRIES },
	states: { default: "alert-menu", phone: "alert-menu" },
	marks: ["severity", "alert"],
});

/** An alert's row or card in the list: right-click, Shift+F10 and the card's ⋯. */
export const alertRow = defineSurface({
	id: "alert.row",
	label: "Alert actions",
	menus: { context: ENTRIES, more: ENTRIES },
	states: { default: "alert-menu", phone: "alert-menu" },
	marks: ["severity", "alert"],
});
