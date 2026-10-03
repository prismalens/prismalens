// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Per-viewer layout choices: the sidebar folded to its rail (`[`), the
 * alerts pane grouped by service or not, and per view which service groups are
 * folded (#743).
 * Kept in localStorage, which can be absent or throw, so every access is
 * guarded and the defaults win without it. The fold is an attribute on the
 * root, so the bar and every frame read one width from tokens.css.
 */
const KEY = "pl.layout";

/** The incident sidebar is always grouped; the alerts pane can be. */
export type GroupView = "list" | "alerts";
export type GroupBy = "none" | "service";
const VIEWS: GroupView[] = ["list", "alerts"];

interface LayoutPrefs {
	sidebarFolded: boolean;
	alertsGroupBy: GroupBy;
	/** Folded group ids, per view. */
	folded: Record<GroupView, string[]>;
}

const DEFAULTS: LayoutPrefs = {
	sidebarFolded: false,
	alertsGroupBy: "none",
	folded: { list: [], alerts: [] },
};
let current: LayoutPrefs = DEFAULTS;
const listeners = new Set<() => void>();

function read(): LayoutPrefs {
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return DEFAULTS;
		const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
		const folded = { ...DEFAULTS.folded };
		for (const v of VIEWS) {
			const f = parsed.folded?.[v];
			if (Array.isArray(f)) folded[v] = f.filter((x) => typeof x === "string");
		}
		return {
			sidebarFolded: !!parsed.sidebarFolded,
			alertsGroupBy: parsed.alertsGroupBy === "service" ? "service" : "none",
			folded,
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
	document.documentElement.toggleAttribute(
		"data-sidebar-folded",
		next.sidebarFolded,
	);
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

	const toggleSidebar = useCallback(
		() => publish({ ...current, sidebarFolded: !current.sidebarFolded }),
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

	return { ...prefs, toggleSidebar, setAlertsGroupBy, toggleLane };
}
