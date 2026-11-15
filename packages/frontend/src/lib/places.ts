// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Activity,
	Bell,
	Boxes,
	FolderGit2,
	House,
	type LucideIcon,
	MessagesSquare,
	SlidersHorizontal,
	Zap,
} from "lucide-react";

export type PlaceId =
	| "home"
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
		| "/new"
		| "/threads"
		| "/automation"
		| "/services"
		| "/incidents"
		| "/alerts"
		| "/projects"
		| "/settings";
	/** Its go key, always with a modifier: a bare letter types into the message box (#1101). */
	keys?: string;
	/** A sidebar door; Operations shows only once alerts have arrived. */
	door?: boolean;
	/** What the place holds, on the door's hover: the nav says what starts threads and where code lives. */
	hint?: string;
	/** A tab inside another place's door: one name in the nav, one tab strip on the page (#1101 nav). */
	within?: PlaceId;
}

/** The one list of places (#1020): the sidebar doors, the palette, go keys and the shortcut sheet read it. */
export const PLACES: readonly Place[] = [
	{ id: "home", label: "Home", icon: House, to: "/new", keys: "Alt+H" },
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
		keys: "Alt+O",
		door: true,
		hint: "Threads that alerts started, by service",
	},
	{
		id: "services",
		label: "Services",
		icon: Boxes,
		to: "/services",
		hint: "Projects grouped so an alert reaches its code",
		within: "projects",
	},
	{ id: "alerts", label: "Alerts", icon: Bell, to: "/alerts", keys: "Alt+A" },
	{
		id: "settings",
		label: "Settings",
		icon: SlidersHorizontal,
		to: "/settings",
		keys: "Alt+,",
		door: true,
	},
];

export const placeOf = (id: PlaceId): Place => {
	const place = PLACES.find((p) => p.id === id);
	if (!place) throw new Error(`No place ${id}`);
	return place;
};

/** A door's place and the places inside it, in registry order: the page's tab strip. */
export const placeTabs = (id: PlaceId): Place[] => {
	const door = placeOf(id);
	const home = door.within ? placeOf(door.within) : door;
	return [home, ...PLACES.filter((p) => p.within === home.id)];
};

/** The go keys, from the one places list. Rendered by the `?` sheet too. */
export const GO_SHORTCUTS = PLACES.flatMap((p) =>
	p.keys ? [{ id: p.id, keys: p.keys, to: p.to, label: p.label }] : [],
);

/** A go key as key caps, for a hint or a palette row. */
export const goCaps = (keys: string | undefined) => keys?.split("+");
