// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Per-viewer layout choices: the sidebar full, folded to its rail, or hidden
 * (`[`, #848), the alerts pane grouped by service or not, per view which
 * service groups are folded (#743), whether the right panel is open (#973), and the bottom panel (#931).
 * Kept in localStorage, which can be absent or throw, so every access is
 * guarded and the defaults win without it. The state is an attribute on the
 * root, so the bar and every frame read one width from tokens.css.
 */
const KEY = "pl.layout";

export type SidebarState = "full" | "folded" | "hidden";
/** The width `[` brings the bar back to. */
export type SidebarRest = Exclude<SidebarState, "hidden">;

/** The incident sidebar is always grouped; the alerts pane can be. */
export type GroupView = "list" | "alerts";
export type GroupBy = "none" | "service";
const VIEWS: GroupView[] = ["list", "alerts"];

interface LayoutPrefs {
	sidebar: SidebarState;
	sidebarRest: SidebarRest;
	alertsGroupBy: GroupBy;
	/** Folded group ids, per view. */
	folded: Record<GroupView, string[]>;
	/** The right panel beside the page; a phone's sheet never reopens on its own. */
	rightPanel: boolean;
	/** The terminal under the page. */
	bottomPanel: boolean;
}

const DEFAULTS: LayoutPrefs = {
	sidebar: "full",
	sidebarRest: "full",
	alertsGroupBy: "none",
	folded: { list: [], alerts: [] },
	rightPanel: false,
	bottomPanel: false,
};
let current: LayoutPrefs = DEFAULTS;
const listeners = new Set<() => void>();

function read(): LayoutPrefs {
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return DEFAULTS;
		const parsed = JSON.parse(raw) as Partial<LayoutPrefs> & {
			/** Before #848 the bar could only fold. */
			sidebarFolded?: boolean;
		};
		const folded = { ...DEFAULTS.folded };
		for (const v of VIEWS) {
			const f = parsed.folded?.[v];
			if (Array.isArray(f)) folded[v] = f.filter((x) => typeof x === "string");
		}
		const rest: SidebarRest =
			parsed.sidebarRest === "folded" ||
			(parsed.sidebar === undefined && parsed.sidebarFolded)
				? "folded"
				: "full";
		return {
			sidebar:
				parsed.sidebar === "hidden" || parsed.sidebar === "folded"
					? parsed.sidebar
					: rest,
			sidebarRest: rest,
			alertsGroupBy: parsed.alertsGroupBy === "service" ? "service" : "none",
			folded,
			rightPanel: parsed.rightPanel === true,
			bottomPanel: parsed.bottomPanel === true,
		};
	} catch {
		return DEFAULTS;
	}
}

function publish(next: LayoutPrefs) {
	current = next;
	try {
		window.localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// A private window or blocked storage: the choice lasts for this page only.
	}
	const root = document.documentElement;
	root.toggleAttribute("data-sidebar-folded", next.sidebar === "folded");
	root.toggleAttribute("data-sidebar-hidden", next.sidebar === "hidden");
	listeners.forEach((l) => {
		l();
	});
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function useLayoutPrefs() {
	const prefs = useSyncExternalStore(
		subscribe,
		() => current,
		() => DEFAULTS,
	);

	// First client render: adopt what the viewer chose last time.
	useEffect(() => {
		if (current === DEFAULTS) {
			const stored = read();
			if (JSON.stringify(stored) !== JSON.stringify(DEFAULTS)) publish(stored);
		}
	}, []);

	/** `[` and the fold button hide the bar; again brings back the width it had. */
	const toggleSidebar = useCallback(
		() =>
			publish({
				...current,
				sidebar: current.sidebar === "hidden" ? current.sidebarRest : "hidden",
			}),
		[],
	);
	const setSidebarRest = useCallback(
		(rest: SidebarRest) =>
			publish({ ...current, sidebar: rest, sidebarRest: rest }),
		[],
	);
	const setAlertsGroupBy = useCallback(
		(value: GroupBy) => publish({ ...current, alertsGroupBy: value }),
		[],
	);
	const toggleLane = useCallback((view: GroupView, laneId: string) => {
		const folded = current.folded[view];
		publish({
			...current,
			folded: {
				...current.folded,
				[view]: folded.includes(laneId)
					? folded.filter((id) => id !== laneId)
					: [...folded, laneId],
			},
		});
	}, []);

	const setRightPanel = useCallback(
		(open: boolean) => publish({ ...current, rightPanel: open }),
		[],
	);
	const setBottomPanel = useCallback(
		(open: boolean) => publish({ ...current, bottomPanel: open }),
		[],
	);

	return {
		...prefs,
		sidebarFolded: prefs.sidebar === "folded",
		sidebarHidden: prefs.sidebar === "hidden",
		toggleSidebar,
		setSidebarRest,
		setAlertsGroupBy,
		toggleLane,
		setRightPanel,
		setBottomPanel,
	};
}
