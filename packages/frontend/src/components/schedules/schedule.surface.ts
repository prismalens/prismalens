// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** A schedule's card: ⋯ and right-click list the same rows (ListCard draws both). */
export const scheduleRow = defineSurface({
	id: "schedule.row",
	label: "Schedule actions",
	menus: {
		more: [
			"schedule.open",
			"schedule.runNow",
			"schedule.pause",
			"schedule.resume",
			"-",
			"schedule.copyLink",
		],
	},
	states: { default: "schedules-list", phone: "schedules-list" },
	marks: ["status"],
});

/** A schedule's own page header: right-click, Shift+F10 and its ⋯ list these rows. */
export const scheduleHeader = defineSurface({
	id: "schedule.header",
	object: "schedule",
	label: "Schedule actions",
	menus: {
		context: [
			"schedule.runNow",
			"schedule.edit",
			"schedule.pause",
			"schedule.resume",
			"schedule.duplicate",
			"-",
			"schedule.copyLink",
			"schedule.delete",
		],
		more: [
			"schedule.pause",
			"schedule.resume",
			"schedule.duplicate",
			"-",
			"schedule.copyLink",
			"schedule.delete",
		],
	},
	states: { default: "schedules-list", phone: "schedules-list" },
	marks: ["status"],
});
