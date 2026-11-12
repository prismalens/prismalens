// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";

/**
 * The docked ask's keys (#1101 category 8 item 4): Alt+Y approves, Alt+N declines,
 * from anywhere on the page, the box included, so typing never answers by accident.
 */
export function useAskKeys(
	enabled: boolean,
	on: { approve: () => void; decline: () => void },
): void {
	const ref = useRef(on);
	ref.current = on;
	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
			// `code` holds on layouts where Alt+Y types a character.
			if (e.code === "KeyY") {
				e.preventDefault();
				ref.current.approve();
			} else if (e.code === "KeyN") {
				e.preventDefault();
				ref.current.decline();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled]);
}
