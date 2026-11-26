// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The page's actions; its rows place the same list (#1127). */
const ENTRIES = [
	"incident.open",
	"incident.details",
	"incident.runs",
	"incident.newConversation",
	"-",
	"incident.resolve",
	"incident.note",
	"incident.statusUpdate",
	"incident.investigateAgain",
	"incident.editCause",
	"-",
	"incident.severityCritical",
	"incident.severityHigh",
	"incident.severityMedium",
	"incident.severityLow",
	"incident.severityInfo",
	"-",
	"incident.merge",
	"incident.mergedInto",
	"incident.export",
] as const;

/** An incident or chat page's header: its ⋯ and right-click hold all but status and the primary action. */
export const incidentHeader = defineSurface({
	id: "incident.header",
	label: "Incident actions",
	menus: { more: ENTRIES, context: ENTRIES },
	states: { default: "incident-header-menu", phone: "incident-header-menu" },
	marks: ["status", "severity"],
});

/** An incident's row in a list (the inbox, All incidents, Working, Recently resolved): the page's list. */
export const incidentRow = defineSurface({
	id: "incident.row",
	label: "Incident actions",
	menus: { more: ENTRIES, context: ENTRIES },
	states: { default: "incident-row-menu", phone: "incident-row-menu" },
	marks: ["status", "severity"],
});
