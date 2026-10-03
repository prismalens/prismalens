// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

/**
 * One Back rule for every leaf (study-v2 §5.1): go to where you came from,
 * else to the leaf's list. "Where you came from" is the newest place visited
 * outside the leaf, so tabs and sibling records are never levels.
 */

const MAX = 30;
const visited: { href: string; pathname: string }[] = [];

export function recordVisit(href: string, pathname: string) {
	if (visited.at(-1)?.href === href) return;
	visited.push({ href, pathname });
	if (visited.length > MAX) visited.shift();
}

/** The newest visited href whose path is outside `inLeaf`, or `fallback`. */
export function backTarget(
	inLeaf: (pathname: string) => boolean,
	fallback: string,
	trail: readonly { href: string; pathname: string }[] = visited,
): string {
	for (let i = trail.length - 1; i >= 0; i--) {
		const entry = trail[i];
		if (entry && !inLeaf(entry.pathname)) return entry.href;
	}
	return fallback;
}

/** What an alert's Back chevron says for `target`, the href it returns to. */
export function alertBackLabel(
	target: string,
	incident?: { id: string; number: number } | null,
): string {
	const path = target.split("?")[0] ?? target;
	if (incident && inIncident(incident.id)(path))
		return `Back to INC-${incident.number}`;
	if (path.startsWith("/incidents/")) return "Back to the incident";
	if (path === "/incidents") return "Back to the board";
	if (path.startsWith("/alerts")) return "Back to alerts";
	return "Back";
}

/** Mounted once in the signed-in layout: keeps the trail Back reads. */
export function useVisitTrail() {
	const router = useRouter();
	useEffect(() => {
		const here = router.state.location;
		recordVisit(here.href, here.pathname);
		return router.subscribe("onResolved", ({ toLocation }) => {
			recordVisit(toLocation.href, toLocation.pathname);
		});
	}, [router]);
}

/** A function that goes Back from the leaf `inLeaf` describes. */
export function useBack(
	inLeaf: (pathname: string) => boolean,
	fallback: string,
) {
	const navigate = useNavigate();
	return useCallback(
		() => navigate({ href: backTarget(inLeaf, fallback) }),
		[navigate, inLeaf, fallback],
	);
}

/** Leaves: one incident (its tabs included), one alert, Settings. */
export const inIncident = (id: string) => (pathname: string) =>
	pathname === `/incidents/${id}` || pathname.startsWith(`/incidents/${id}/`);
export const inAlertRecord = (pathname: string) =>
	pathname.startsWith("/alerts/");
export const inSettings = (pathname: string) =>
	pathname.startsWith("/settings");
