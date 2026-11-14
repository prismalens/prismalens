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
	/** What the place holds, on the door's hover: the nav says what starts threads and where code lives. */
	hint?: string;
}

/** The one list of places (#1020): the sidebar doors, the palette, `g` keys and the shortcut sheet read it. */
export const PLACES: readonly Place[] = [
	{
		id: "automation",
		label: "Triggers",
		icon: Zap,
		to: "/automation",
		door: true,
		hint: "Schedules, alerts and webhooks that start threads",
	},
	{
		id: "projects",
		label: "Projects",
		icon: FolderGit2,
		to: "/projects",
		door: true,
		hint: "Where your code lives",
	},
	{
		id: "incidents",
		label: "Operations",
		icon: Activity,
		to: "/incidents",
		goKey: "o",
		door: true,
		hint: "Threads that alerts started, by service",
	},
	{
		id: "services",
		label: "Services",
		icon: Boxes,
		to: "/services",
		hint: "Projects grouped so an alert reaches its code",
	},
	{ id: "alerts", label: "Alerts", icon: Bell, to: "/alerts", goKey: "a" },
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

/** The `g` chords, from the one places list: where each second key goes. Rendered by the `?` sheet too. */
export const GO_SHORTCUTS = PLACES.flatMap((p) =>
	p.goKey ? [{ id: p.id, key: p.goKey, to: p.to, label: p.label }] : [],
);
