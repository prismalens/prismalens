// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The phone's Home (#1101 category 5 item 2): the threads that need you first,
 * each opening at its ask, then the rest by status. Agent text stays plain strings.
 */
import type { ThreadStatus, ThreadUnit } from "@prismalens/contracts";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { type ThreadLink, threadLink } from "@/lib/thread-rows";
import {
	needsYouNow,
	STATUS_WORD,
	statusOf,
	statusReason,
} from "@/lib/thread-status";

/** Needs-you statuses first, in the order a phone reader acts on them. */
export const HOME_ORDER: readonly ThreadStatus[] = [
	"approval",
	"question",
	"limited",
	"blocked",
	"failed",
	"working",
	"waiting",
	"done",
];

/** Rows below the needs-you group before "All threads". */
export const HOME_REST = 15;

export type HomeLink =
	| ThreadLink
	| { to: "/threads/$id"; params: { id: string }; search: { ask: string } };

export interface HomeItem {
	id: string;
	title: string;
	status: ThreadStatus;
	word: string;
	/** The ask, the reason or the live step; null drops the line. */
	line: string | null;
	context: string | null;
	at: number;
	needs: boolean;
	link: HomeLink;
}

/** A thread link that lands on its ask's card when the thread page holds one. */
function linkTo(
	t: Parameters<typeof threadLink>[0],
	askId: string | null,
): HomeLink {
	const link = threadLink(t);
	return askId && link.to === "/threads/$id"
		? { ...link, search: { ask: askId } }
		: link;
}

export function homeItems(
	units: readonly ThreadUnit[],
	asks: ReadonlyMap<string, RowAskEntry[]>,
	now: number,
): { needs: HomeItem[]; rest: HomeItem[]; more: number } {
	const all: HomeItem[] = [];
	for (const u of units)
		for (const t of u.threads) {
			const info = statusOf(t);
			const needs = needsYouNow(t, info);
			if (!needs && u.section === "settled") continue;
			const ask = asks.get(t.id)?.[0]?.ask ?? null;
			all.push({
				id: t.id,
				title:
					t.title?.trim() ||
					u.incident?.title ||
					(t.kind === "chat" ? "Thread" : "Run"),
				status: info.status,
				word: STATUS_WORD[info.status],
				line: ask?.title ?? statusReason(t, info, now) ?? t.latestText ?? null,
				context: t.projectName ?? t.serviceName ?? null,
				at: Date.parse(t.lastActivityAt),
				needs,
				link: linkTo(t, needs ? (ask?.askId ?? null) : null),
			});
		}
	const rank = (s: ThreadStatus) => HOME_ORDER.indexOf(s);
	all.sort((a, b) => rank(a.status) - rank(b.status) || b.at - a.at);
	const rest = all.filter((i) => !i.needs);
	return {
		needs: all.filter((i) => i.needs),
		rest: rest.slice(0, HOME_REST),
		more: Math.max(0, rest.length - HOME_REST),
	};
}
