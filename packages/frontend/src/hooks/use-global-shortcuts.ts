// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { NEW_INCIDENT_KEY } from "@/components/shell/NewIncident";
import { EARLY_CHORD_MS, takeEarlyKeys } from "@/lib/early-keys";

/** The `g` chords: where each second key goes. Rendered by the `?` sheet too. */
export const GO_SHORTCUTS = [
	{ key: "i", to: "/incidents", label: "Incidents" },
	{ key: "a", to: "/alerts", label: "Alerts" },
	{ key: "s", to: "/settings", label: "Settings" },
] as const;

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!el?.isContentEditable
	);
}

/**
 * `g` then `i` / `a` / `s` moves between the front doors; `c` opens New
 * thread with Incident on; `?` opens the shortcut sheet. Mounted once in the authenticated
 * layout. A chord waits one second for its second key, then forgets the first.
 */
export function useGlobalShortcuts(onHelp: () => void, onNew: () => void) {
	const navigate = useNavigate();
	const pending = useRef<number | null>(null);

	useEffect(() => {
		/** True when the key did something, so the event's default is dropped. */
		const run = (key: string, at = Date.now()): boolean => {
			if (pending.current !== null) {
				window.clearTimeout(pending.current);
				pending.current = null;
				const go = GO_SHORTCUTS.find((s) => s.key === key);
				if (go) navigate({ to: go.to });
				return !!go;
			}
			if (key === "g") {
				// A buffered g counts its age against the window; one already past it arms nothing.
				const left = EARLY_CHORD_MS - (Date.now() - at);
				if (left <= 0) return false;
				pending.current = window.setTimeout(() => {
					pending.current = null;
				}, left);
			} else if (key === "?") {
				onHelp();
				return true;
			} else if (key === NEW_INCIDENT_KEY) {
				if (document.querySelector("[role=dialog], [role=alertdialog]"))
					return false;
				onNew();
				return true;
			}
			return false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			if (run(e.key)) e.preventDefault();
		};
		let last = 0;
		for (const early of takeEarlyKeys()) {
			if (pending.current !== null && early.t - last > EARLY_CHORD_MS) {
				window.clearTimeout(pending.current);
				pending.current = null;
			}
			run(early.k, early.t);
			last = early.t;
		}
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			if (pending.current !== null) window.clearTimeout(pending.current);
		};
	}, [navigate, onHelp, onNew]);
}
