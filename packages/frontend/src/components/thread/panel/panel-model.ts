// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContextKind } from "@prismalens/contracts";

/** The panel's tabs as the URL names them (#1024): at most three, plus Browser on demand. */
export const PANEL_IDS = ["kind", "thread", "changes", "browser"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** The Thread tab's sections, top first; each is absent when empty. */
export const THREAD_SECTIONS = [
	"pull-requests",
	"threads",
	"plan",
	"steps",
	"scheduled",
	"machine",
] as const;
export type ThreadSection = (typeof THREAD_SECTIONS)[number];

/** `?panel=<tab>&section=<id>&path=&line=`: the panel's state on every thread route. */
export interface PanelSearch {
	panel?: PanelId;
	section?: string;
	path?: string;
	line?: number;
}

export function panelSearchOf(search: Record<string, unknown>): PanelSearch {
	const panel = PANEL_IDS.find((p) => p === search.panel);
	const line = Number(search.line);
	return {
		...(panel ? { panel } : {}),
		...(typeof search.section === "string" && search.section
			? { section: search.section }
			: {}),
		...(typeof search.path === "string" && search.path
			? { path: search.path }
			: {}),
		...(Number.isInteger(line) && line > 0 ? { line } : {}),
	};
}

/** The kind tab's name; a thread with no subject has none. */
export const KIND_TAB: Record<ThreadContextKind, string | null> = {
	incident: "Incident",
	schedule: "Runs",
	service: "Service",
	project: "Project",
	none: null,
};

export interface PanelTab {
	id: PanelId;
	label: string;
	/** Items in the tab that need a look (flagged content): a dot and a count for screen readers. */
	flagged?: number;
}

/** Which tabs show: a tab with nothing in it is absent, never disabled. */
export function panelTabs(o: {
	kind: ThreadContextKind | null;
	thread: boolean;
	changes: boolean;
	browser: boolean;
}): PanelTab[] {
	const kind = o.kind ? KIND_TAB[o.kind] : null;
	return [
		...(kind ? [{ id: "kind" as const, label: kind }] : []),
		...(o.thread ? [{ id: "thread" as const, label: "Thread" }] : []),
		...(o.changes ? [{ id: "changes" as const, label: "Changes" }] : []),
		...(o.browser ? [{ id: "browser" as const, label: "Browser" }] : []),
	];
}

/** The tab to show: the asked one when it exists, else the first. */
export function shownTab(tabs: PanelTab[], asked: PanelId | undefined) {
	return tabs.find((t) => t.id === asked)?.id ?? tabs[0]?.id ?? null;
}

const LAST_KEY = "pl.panel.tab.";

/** The last tab per thread, so the panel reopens where it was (URL first, then this). */
export function rememberTab(threadId: string, tab: PanelId): void {
	try {
		localStorage.setItem(LAST_KEY + threadId, tab);
	} catch {}
}

export function rememberedTab(threadId: string): PanelId | undefined {
	try {
		const v = localStorage.getItem(LAST_KEY + threadId);
		return PANEL_IDS.find((p) => p === v);
	} catch {
		return undefined;
	}
}
