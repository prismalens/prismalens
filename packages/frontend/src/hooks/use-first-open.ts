// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { backTarget } from "@/hooks/use-back";
import { SPLIT_PANES, useMediaQuery } from "@/hooks/use-media-query";

/** Areas that opened their first record on this visit; leaving one clears it. */
const opened = new Set<string>();
let watching = false;

/**
 * A list door at ≥ 1024 opens its first record instead of a bare page (look
 * ruling L26, L32), once per visit: Back to the list must not bounce into it
 * again, and a cold load of the list (a bookmark, a test) keeps the list.
 * Returns whether the caller should open it now.
 */
export function useFirstOpen(area: string, allowed: boolean): boolean {
	const router = useRouter();
	const wide = useMediaQuery(SPLIT_PANES);
	useEffect(() => {
		if (watching) return;
		watching = true;
		router.subscribe("onResolved", ({ toLocation }) => {
			for (const a of Array.from(opened))
				if (!toLocation.pathname.startsWith(a)) opened.delete(a);
		});
	}, [router]);
	const [arrived] = useState(
		() => !opened.has(area) && backTarget((p) => p.startsWith(area), "") !== "",
	);
	return allowed && arrived && wide;
}

/** The caller opened its first record; the area stays a list until left. */
export function markFirstOpened(area: string) {
	opened.add(area);
}
