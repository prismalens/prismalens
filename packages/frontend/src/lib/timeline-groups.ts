// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TimelineEntryWithRelations } from "@prismalens/contracts";

export interface InvestigationRef {
	id: string;
	status: string;
	error?: string | null;
}

export type TimelineItem =
	| { kind: "entry"; entry: TimelineEntryWithRelations }
	| {
			kind: "investigation";
			id: string;
			/** 1 for the incident's first investigation; null when it is not on the incident. */
			number: number | null;
			run: InvestigationRef | null;
			/** When its newest entry landed. */
			at: string;
			/** Newest first. */
			entries: TimelineEntryWithRelations[];
			/** It ran with no repository, so the agent read no code. */
			noRepo: boolean;
	  };

function investigationOf(entry: TimelineEntryWithRelations): string | null {
	const id = entry.metadata?.investigationId;
	return typeof id === "string" ? id : null;
}

/**
 * The timeline newest first, with every entry an investigation wrote folded
 * into one item per investigation (#743). `runs` is the incident's
 * investigations, newest first.
 */
export function groupTimeline(
	entries: TimelineEntryWithRelations[],
	runs: InvestigationRef[],
): TimelineItem[] {
	const sorted = [...entries].sort(
		(a, b) =>
			new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
	);
	const items: TimelineItem[] = [];
	const groups = new Map<
		string,
		Extract<TimelineItem, { kind: "investigation" }>
	>();
	for (const entry of sorted) {
		const id = investigationOf(entry);
		if (!id) {
			items.push({ kind: "entry", entry });
			continue;
		}
		let group = groups.get(id);
		if (!group) {
			const index = runs.findIndex((r) => r.id === id);
			group = {
				kind: "investigation",
				id,
				number: index >= 0 ? runs.length - index : null,
				run: index >= 0 ? (runs[index] ?? null) : null,
				at: entry.occurredAt,
				entries: [],
				noRepo: false,
			};
			groups.set(id, group);
			items.push(group);
		}
		group.entries.push(entry);
		if (entry.metadata?.mapped === false) group.noRepo = true;
	}
	return items;
}
