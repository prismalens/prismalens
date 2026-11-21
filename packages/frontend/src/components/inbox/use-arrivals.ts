// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Grouped, groupNeeds, matches } from "./inbox-model";

/**
 * Rows that appear after the first paint settle in with the arrival glow, once. Held by the
 * inbox, not Needs you: an empty inbox has no Needs you, and its first arrival must glow (#891).
 */
export function useArrivals(groups: Grouped[], ready: boolean): Set<string> {
	const seen = useRef<Set<string> | null>(null);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const timers = useRef<number[]>([]);
	const ids = groups.flatMap((g) => g.rows.map((r) => r.id)).join(",");
	useEffect(() => {
		if (!ready) return;
		const now = ids ? ids.split(",") : [];
		if (seen.current === null) {
			seen.current = new Set(now);
			return;
		}
		const added = now.filter((id) => !seen.current?.has(id));
		for (const id of now) seen.current.add(id);
		if (added.length === 0) return;
		setFresh((f) => new Set(Array.from(f).concat(added)));
		// Each batch ends its own glow: a later arrival must not cancel an earlier timer.
		timers.current.push(
			window.setTimeout(
				() =>
					setFresh(
						(f) => new Set(Array.from(f).filter((id) => !added.includes(id))),
					),
				3000,
			),
		);
	}, [ids, ready]);
	useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
	return fresh;
}

/**
 * The groups Needs you shows under the text filter, and the arrivals among ALL incidents:
 * the seen set must not depend on the filter, or clearing it would glow every hidden row (#1197).
 */
export function useInboxGroups(
	incidents: IncidentWithRelations[],
	filter: string,
	ready: boolean,
): { groups: Grouped[]; arrived: Set<string> } {
	const all = useMemo(() => groupNeeds(incidents), [incidents]);
	const groups = useMemo(
		() =>
			filter ? groupNeeds(incidents.filter((i) => matches(i, filter))) : all,
		[all, incidents, filter],
	);
	return { groups, arrived: useArrivals(all, ready) };
}
