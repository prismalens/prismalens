// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ReferenceHit,
	ReferenceSearchResult,
} from "@prismalens/contracts";
import type { ActiveTrigger } from "./trigger";

/** A page's own `/` action (Ask, Investigate, Note), offered beside the search's commands. */
export interface LocalCommand {
	id: string;
	label: string;
	detail?: string;
}

/** App commands only a page can run: the search lists them, the page's actions decide. */
const PAGE_ACTIONS = new Set(["investigate", "ask", "note"]);

/**
 * What the menu shows (#1024): the search's hits, and under `/` the page's own actions
 * first in the PrismaLens group. A page action the page does not offer is left out.
 */
export function menuResult(
	data: ReferenceSearchResult | undefined,
	trigger: Pick<ActiveTrigger, "trigger" | "query">,
	local: readonly LocalCommand[] | undefined,
): ReferenceSearchResult | undefined {
	if (trigger.trigger !== "/") return data;
	const q = trigger.query.toLowerCase();
	const own: ReferenceHit[] = (local ?? [])
		.filter((c) => c.id.startsWith(q))
		.map((c) => ({
			ref: { kind: "command", id: c.id, label: `/${c.id}` },
			detail: c.detail ?? c.label,
			source: "app",
			group: "PrismaLens",
			why: "match",
			score: 1,
		}));
	if (!data)
		return own.length
			? { hits: own, truncated: false, unavailable: [] }
			: undefined;
	const ids = new Set(own.map((h) => h.ref.id));
	const server = data.hits.filter(
		(h) =>
			!(
				h.source === "app" &&
				(PAGE_ACTIONS.has(h.ref.id) || ids.has(h.ref.id))
			),
	);
	return { ...data, hits: [...own, ...server] };
}
