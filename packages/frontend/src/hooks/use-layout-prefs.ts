// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Per-viewer layout choices: the sidebar folded to an icon rail (`[`), the
 * record's rail hidden (`]`). Kept in localStorage, which can be absent or
 * throw, so every access is guarded and the defaults win without it. The
 * sidebar width is published as a CSS variable so the frame and the main
 * column offset by the same amount without sharing React state.
 */
const KEY = "pl.layout";
const SIDEBAR_WIDTH = { open: "14rem", folded: "3.5rem" } as const;

export type RecordSurface = "run" | "alerts" | "timeline" | "telemetry";

interface LayoutPrefs {
	sidebarFolded: boolean;
	/** The record's open surface; null means the pane is hidden. */
	surface: RecordSurface | null;
}

const SURFACES: RecordSurface[] = ["run", "alerts", "timeline", "telemetry"];
const DEFAULTS: LayoutPrefs = { sidebarFolded: false, surface: "run" };
let current: LayoutPrefs = DEFAULTS;
const listeners = new Set<() => void>();

function read(): LayoutPrefs {
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return DEFAULTS;
		const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
		return {
			sidebarFolded: !!parsed.sidebarFolded,
			surface:
				parsed.surface === null
					? null
					: SURFACES.includes(parsed.surface as RecordSurface)
						? (parsed.surface as RecordSurface)
						: DEFAULTS.surface,
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
	document.documentElement.style.setProperty(
		"--sidebar-w",
		next.sidebarFolded ? SIDEBAR_WIDTH.folded : SIDEBAR_WIDTH.open,
	);
	listeners.forEach((l) => l());
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
			if (
				stored.sidebarFolded !== DEFAULTS.sidebarFolded ||
				stored.surface !== DEFAULTS.surface
			) {
				publish(stored);
			}
		}
	}, []);

	const toggleSidebar = useCallback(
		() => publish({ ...current, sidebarFolded: !current.sidebarFolded }),
		[],
	);
	/** Open a surface; the open one closes the pane. */
	const pickSurface = useCallback(
		(s: RecordSurface) =>
			publish({ ...current, surface: current.surface === s ? null : s }),
		[],
	);
	const toggleSurfacePane = useCallback(
		() =>
			publish({
				...current,
				surface: current.surface === null ? DEFAULTS.surface : null,
			}),
		[],
	);

	return { ...prefs, toggleSidebar, pickSurface, toggleSurfacePane };
}
