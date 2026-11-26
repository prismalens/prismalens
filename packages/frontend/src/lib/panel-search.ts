// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The routes read only this part of a run address, so the run panel's code stays off the shell.
/** The right panel's tabs, as the URL names them (#973). */
export const PANEL_TABS = [
	"incident",
	"summary",
	"files",
	"changes",
	"steps",
	"context",
	"browser",
] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export function panelTab(v: unknown): PanelTab | undefined {
	return PANEL_TABS.find((t) => t === v);
}

/** The panel's part of a run address, `?panel=` and `?file=`, kept wherever the address is rewritten. */
export function panelSearch(search: Record<string, unknown>): {
	panel?: PanelTab;
	file?: string;
} {
	const panel = panelTab(search.panel);
	return {
		...(panel ? { panel } : {}),
		...(typeof search.file === "string" ? { file: search.file } : {}),
	};
}
