// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContextKind } from "@prismalens/contracts";

/** The panes as the URL names them (#1024); none open shows the details card (sheet §3). */
export const PANEL_IDS = [
	"kind",
	"thread",
	"changes",
	"files",
	"browser",
	"new",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/**
 * How each pane sits in the panel (#1101 categories 16 and 21): `wide` panes widen it when
 * they open, until the user narrows it there; `tile` panes can sit under another.
 */
export const PANE_VIEW: Readonly<
	Record<PanelId, { wide: boolean; tile: boolean }>
> = {
	kind: { wide: false, tile: true },
	thread: { wide: false, tile: true },
	changes: { wide: true, tile: true },
	files: { wide: false, tile: true },
	browser: { wide: false, tile: true },
	new: { wide: false, tile: false },
};

const WIDE_KEY = "pl.panel.wide.";

/** Whether a pane widens the panel: its default until the user widens or narrows it there. */
export function paneWide(id: PanelId): boolean {
	try {
		const v = localStorage.getItem(WIDE_KEY + id);
		return v === null ? PANE_VIEW[id].wide : v === "1";
	} catch {
		return PANE_VIEW[id].wide;
	}
}

export function rememberPaneWide(id: PanelId, wide: boolean): void {
	try {
		localStorage.setItem(WIDE_KEY + id, wide ? "1" : "0");
	} catch {}
}

/** Which diff the Changes tab shows (#1101 category 16); `all` when the URL names none. */
export const DIFF_SCOPES = ["all", "turn", "uncommitted", "outside"] as const;
export type DiffScope = (typeof DIFF_SCOPES)[number];

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

/**
 * `?panel=<tab>&section=<id>&path=&line=&scope=&turn=&view=&split=`: the panel's state on
 * every thread route. `path=<repo>:<path>&line=N` is the stable "file at line" address; `split`
 * names the pane tiled under the shown one.
 */
export interface PanelSearch {
	panel?: PanelId;
	section?: string;
	path?: string;
	line?: number;
	scope?: DiffScope;
	/** The turn's first seq, for `scope=turn`. */
	turn?: number;
	view?: "diff" | "file";
	split?: PanelId;
	/** Open find with this query: a palette hit lands with find at it (#1101 cat 13). */
	find?: string;
}

export function panelSearchOf(search: Record<string, unknown>): PanelSearch {
	const panel = PANEL_IDS.find((p) => p === search.panel);
	const line = Number(search.line);
	const turn = search.turn === undefined ? Number.NaN : Number(search.turn);
	const scope = DIFF_SCOPES.find((s) => s === search.scope);
	const split = PANEL_IDS.find((p) => p === search.split);
	return {
		...(panel ? { panel } : {}),
		...(typeof search.section === "string" && search.section
			? { section: search.section }
			: {}),
		...(typeof search.path === "string" && search.path
			? { path: search.path }
			: {}),
		...(Number.isInteger(line) && line > 0 ? { line } : {}),
		...(scope ? { scope } : {}),
		...(Number.isInteger(turn) && turn >= 0 && search.turn !== ""
			? { turn }
			: {}),
		...(search.view === "diff" || search.view === "file"
			? { view: search.view }
			: {}),
		...(split && split !== panel ? { split } : {}),
		...(typeof search.find === "string" && search.find
			? { find: search.find.slice(0, 200) }
			: {}),
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

/** Which panes show: one with nothing in it is absent, never disabled. `thread` is the full details. */
export function panelTabs(o: {
	kind: ThreadContextKind | null;
	thread: boolean;
	changes: boolean;
	browser: boolean;
	files?: boolean;
	/** The New tab page, while it is the shown pane. */
	newTab?: boolean;
}): PanelTab[] {
	const kind = o.kind ? KIND_TAB[o.kind] : null;
	return [
		...(kind ? [{ id: "kind" as const, label: kind }] : []),
		...(o.thread ? [{ id: "thread" as const, label: "Details" }] : []),
		...(o.changes ? [{ id: "changes" as const, label: "Changes" }] : []),
		...(o.files ? [{ id: "files" as const, label: "Files" }] : []),
		...(o.browser ? [{ id: "browser" as const, label: "Browser" }] : []),
		...(o.newTab ? [{ id: "new" as const, label: "New tab" }] : []),
	];
}

/** The tab to show: the asked one when it exists, else the first. */
export function shownTab(tabs: PanelTab[], asked: PanelId | undefined) {
	return tabs.find((t) => t.id === asked)?.id ?? tabs[0]?.id ?? null;
}

const LAST_KEY = "pl.panel.tab.";
const LAYOUT_KEY = "pl.panel.layout.";

/** The last tab per thread, so the panel reopens where it was (URL first, then this). */
export function rememberTab(threadId: string, tab: PanelId): void {
	if (tab === "new") return;
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

/** A thread's panes (#1101 category 21): what was open, tiled and split, so they come back with it. */
export interface PaneLayout {
	split: PanelId | null;
	/** The top pane's share of the panel's height, 0.2 to 0.8. */
	ratio: number;
	/** Panes the pane menu opened that are not shown by default. */
	opened: PanelId[];
	browserUrl: string | null;
}

export const DEFAULT_LAYOUT: PaneLayout = {
	split: null,
	ratio: 0.5,
	opened: [],
	browserUrl: null,
};

export function rememberLayout(threadId: string, layout: PaneLayout): void {
	try {
		localStorage.setItem(LAYOUT_KEY + threadId, JSON.stringify(layout));
	} catch {}
}

export function rememberedLayout(threadId: string): PaneLayout {
	try {
		const raw = JSON.parse(
			localStorage.getItem(LAYOUT_KEY + threadId) ?? "null",
		) as Partial<PaneLayout> | null;
		if (!raw || typeof raw !== "object") return DEFAULT_LAYOUT;
		const ids = (v: unknown) =>
			Array.isArray(v)
				? v.filter((x): x is PanelId => PANEL_IDS.some((p) => p === x))
				: [];
		const ratio = Number(raw.ratio);
		return {
			split: ids([raw.split])[0] ?? null,
			ratio: ratio >= 0.2 && ratio <= 0.8 ? ratio : 0.5,
			opened: ids(raw.opened),
			browserUrl: typeof raw.browserUrl === "string" ? raw.browserUrl : null,
		};
	} catch {
		return DEFAULT_LAYOUT;
	}
}
