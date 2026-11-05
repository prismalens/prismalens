// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { rowStateOf } from "@/components/inbox/inbox-model";
import { readableTitle } from "@/lib/title";
import { triggerOf } from "@/lib/trigger";

/** One line item of "while you were away"; `incidentId` set when it is about one thread. */
export interface AwayItem {
	key: "arrived" | "finished" | "needs";
	text: string;
	incidentId: string | null;
}

const t = (at: string | null | undefined) => (at ? Date.parse(at) : 0);
const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/**
 * What happened since `since` (#1020, events principle 3): threads a trigger
 * started, runs that finished, and what needs you now. Empty when nothing did,
 * so the strip is absent rather than an empty box.
 */
export function awayItems(
	incidents: IncidentWithRelations[],
	since: number | null,
): AwayItem[] {
	if (since === null) return [];
	const arrived = incidents.filter(
		(i) =>
			triggerOf(i).kind !== "you" && t(i.createdAt ?? i.triggeredAt) > since,
	);
	const finished = incidents.filter((i) =>
		(i.investigations ?? []).some((r) => t(r.completedAt) > since),
	);
	// One count unit in the shell: threads waiting on an approval or answer (#1020).
	const needs = incidents.filter((i) => rowStateOf(i) === "asks");
	const items: AwayItem[] = [];
	const one = (list: IncidentWithRelations[]) =>
		list.length === 1 ? (list[0]?.id ?? null) : null;
	// The newest thread is named; the rest are counted (#1020: counts alone say nothing).
	const named = (list: IncidentWithRelations[], verb: string, noun: string) => {
		const [first] = [...list].sort(
			(a, b) => t(b.updatedAt ?? b.createdAt) - t(a.updatedAt ?? a.createdAt),
		);
		if (!first?.title) return null;
		const title = readableTitle(first.title);
		// What happened comes first, so a cut line loses the title, never the verb (#1020).
		return list.length === 1
			? `${title} ${verb}`
			: `${list.length} ${noun} ${verb}, newest ${title}`;
	};
	if (arrived.length)
		items.push({
			key: "arrived",
			text:
				named(arrived, "arrived", "threads") ??
				(arrived.every((i) => triggerOf(i).kind === "alert")
					? plural(arrived.length, "alert arrived", "alerts arrived")
					: plural(arrived.length, "event arrived", "events arrived")),
			incidentId: one(arrived),
		});
	if (finished.length)
		items.push({
			key: "finished",
			text:
				named(finished, "finished", "runs") ??
				plural(finished.length, "run finished", "runs finished"),
			incidentId: one(finished),
		});
	if (items.length && needs.length)
		items.push({
			key: "needs",
			text: `${needs.length} waiting for you`,
			incidentId: one(needs),
		});
	return items;
}
