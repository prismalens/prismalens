// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { orpc } from "@/lib/api/orpc-client";

/**
 * The panel width's key, read by the shell at first paint. `appearancePanelWidth` holds the
 * same literal; a test pins them. Importing the setting would put the registry in the shell.
 */
export const PANEL_WIDTH_KEY = "pl.panelWidth";

/**
 * Settings with `scope: "person"` (the setting registry): one value per person, stored on
 * the server; the browser keeps a cache so a first paint reads the last value (#1101 cat 12).
 */
let server: Record<string, string> = {};
const listeners = new Set<() => void>();
const tell = () =>
	listeners.forEach((l) => {
		l();
	});

/** Re-reads the subscriber when the server's copy or a change lands. */
export function onPersonSettings(l: () => void): () => void {
	listeners.add(l);
	return () => listeners.delete(l);
}

/** The cached value for `key`, or null. */
export function readPersonSetting(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function cache(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// A private window: the server keeps it.
	}
}

/** Sets it here at once and saves it for the person's other devices. */
export function writePersonSetting(key: string, value: string): void {
	cache(key, value);
	server = { ...server, [key]: value };
	tell();
	void save();
}

// One save in flight: each replaces the whole set, so two racing could land an older one last.
let saving: Promise<void> | null = null;
let again = false;
function save(): Promise<void> {
	if (saving) {
		again = true;
		return saving;
	}
	saving = orpc.settings.person.update
		.call({ values: server })
		.then(
			() => {},
			() => {
				// Offline: the cache holds it; the next change saves the whole set.
			},
		)
		.finally(() => {
			saving = null;
			if (again) {
				again = false;
				void save();
			}
		});
	return saving;
}

/** Loads the person's settings into the cache; mounted once by the signed-in layout. */
export function usePersonSettingsLoader(): void {
	const { data } = useQuery(
		orpc.settings.person.get.queryOptions({ input: {} }),
	);
	useEffect(() => {
		if (!data) return;
		server = { ...data.values };
		for (const [k, v] of Object.entries(data.values)) cache(k, v);
		tell();
	}, [data]);
}
