// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

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
 * `g` then `i` / `a` / `s` moves between the front doors; `?` opens the
 * shortcut sheet. Mounted once in the authenticated layout. A chord waits one
 * second for its second key, then forgets the first.
 */
export function useGlobalShortcuts(onHelp: () => void) {
	const navigate = useNavigate();
	const pending = useRef<number | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			if (pending.current !== null) {
				window.clearTimeout(pending.current);
				pending.current = null;
				const go = GO_SHORTCUTS.find((s) => s.key === e.key);
				if (go) {
					e.preventDefault();
					navigate({ to: go.to });
				}
				return;
			}
			if (e.key === "g") {
				pending.current = window.setTimeout(() => {
					pending.current = null;
				}, 1000);
			} else if (e.key === "?") {
				e.preventDefault();
				onHelp();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			if (pending.current !== null) window.clearTimeout(pending.current);
		};
	}, [navigate, onHelp]);
}
