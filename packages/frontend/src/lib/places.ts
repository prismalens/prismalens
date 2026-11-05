// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Bell,
	Boxes,
	CalendarClock,
	FolderGit2,
	Inbox,
	type LucideIcon,
	SlidersHorizontal,
} from "lucide-react";

export type PlaceId =
	| "incidents"
	| "alerts"
	| "services"
	| "projects"
	| "schedules"
	| "settings";

export interface Place {
	id: PlaceId;
	label: string;
	icon: LucideIcon;
	to: "/incidents" | "/alerts" | "/services" | "/projects" | "/settings";
	search?: { tab: "schedules" };
	/** The second key after `g`. */
	goKey?: string;
	/** A sidebar door and a phone strip button. */
	door?: boolean;
}

/** The one list of places (#1020): the sidebar doors, the palette, `g` keys and the shortcut sheet read it. */
export const PLACES: readonly Place[] = [
	{
		id: "incidents",
		label: "Incidents",
		icon: Inbox,
		to: "/incidents",
		goKey: "i",
		door: true,
	},
	{
		id: "alerts",
		label: "Alerts",
		icon: Bell,
		to: "/alerts",
		goKey: "a",
		door: true,
	},
	{
		id: "services",
		label: "Services",
		icon: Boxes,
		to: "/services",
		door: true,
	},
	{ id: "projects", label: "Projects", icon: FolderGit2, to: "/projects" },
	{
		id: "schedules",
		label: "Scheduled prompts",
		icon: CalendarClock,
		to: "/settings",
		search: { tab: "schedules" },
	},
	{
		id: "settings",
		label: "Settings",
		icon: SlidersHorizontal,
		to: "/settings",
		goKey: "s",
		door: true,
	},
];

export const placeOf = (id: PlaceId): Place => {
	const place = PLACES.find((p) => p.id === id);
	if (!place) throw new Error(`No place ${id}`);
	return place;
};
