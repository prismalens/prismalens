// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Activity,
	Bell,
	Boxes,
	FolderGit2,
	type LucideIcon,
	MessagesSquare,
	SlidersHorizontal,
	Zap,
} from "lucide-react";

export type PlaceId =
	| "threads"
	| "automation"
	| "services"
	| "incidents"
	| "alerts"
	| "projects"
	| "settings";

export interface Place {
	id: PlaceId;
	label: string;
	icon: LucideIcon;
	to:
		| "/threads"
		| "/automation"
		| "/services"
		| "/incidents"
		| "/alerts"
		| "/projects"
		| "/settings";
	/** The second key after `g`. */
	goKey?: string;
	/** A sidebar door; Operations shows only once alerts have arrived. */
	door?: boolean;
}

/** The one list of places (#1020): the sidebar doors, the palette, `g` keys and the shortcut sheet read it. */
export const PLACES: readonly Place[] = [
	{
		id: "threads",
		label: "Threads",
		icon: MessagesSquare,
		to: "/threads",
		goKey: "t",
		door: true,
	},
	{
		id: "automation",
		label: "Automation",
		icon: Zap,
		to: "/automation",
		door: true,
	},
	{
		id: "services",
		label: "Services",
		icon: Boxes,
		to: "/services",
		door: true,
	},
	{
		id: "incidents",
		label: "Operations",
		icon: Activity,
		to: "/incidents",
		goKey: "o",
		door: true,
	},
	{ id: "alerts", label: "Alerts", icon: Bell, to: "/alerts", goKey: "a" },
	{ id: "projects", label: "Projects", icon: FolderGit2, to: "/projects" },
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
