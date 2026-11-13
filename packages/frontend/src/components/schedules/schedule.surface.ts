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
