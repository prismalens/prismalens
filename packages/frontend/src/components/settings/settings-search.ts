// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { allSettings } from "@/components/kit/registry";
import { shortcuts } from "@/lib/shortcuts";
import type { SettingsTab } from "./SettingsFrame";

/** One search result: a setting's page, the row's anchor, its name and one plain sentence. */
export interface SettingResult {
	tab: SettingsTab;
	/** The row's or group's test id, which is also its anchor; absent opens the page's top. */
	anchor?: string;
	name: string;
	sentence: string;
	/** Other words a person might type for it. */
	also?: string;
}

/** Each page's own name, lowercased, so a query naming a page ranks its rows first; in page order. */
const PAGE_WORDS: Record<SettingsTab, string> = {
	general: "general",
	models: "models",
	permissions: "permissions",
	organizer: "organizer limits",
	agent: "agents",
	appearance: "appearance",
	notifications: "notifications",
	shortcuts: "keyboard shortcuts",
	usage: "usage",
	runs: "runs",
	"alert-intake": "alert intake",
	sources: "sources",
	devices: "devices",
	telemetry: "usage data",
	about: "about",
};
const PAGE_ORDER = Object.keys(PAGE_WORDS) as SettingsTab[];

/**
 * What search lists (#1101 cat 18): every registered setting, in page order,
 * then every key from the keyboard. Nothing here is hand-kept.
 */
export function settingRows(): SettingResult[] {
	const settings = allSettings()
		.map((s, i) => ({ s, i }))
		.sort(
			(a, b) =>
				PAGE_ORDER.indexOf(a.s.page) - PAGE_ORDER.indexOf(b.s.page) ||
				a.i - b.i,
		)
		.map(({ s }) => ({
			tab: s.page,
			anchor: s.anchor,
			name: s.label,
			sentence: s.sentence,
			also: s.also,
		}));
	const keys = shortcuts().map((s) => ({
		tab: "shortcuts" as const,
		anchor: `shortcut-${s.id}`,
		name: s.label,
		sentence: s.fixed
			? "Keyboard shortcut, fixed."
			: "Keyboard shortcut; remap it.",
		also: `shortcut key keyboard ${s.keys}`,
	}));
	return [...settings, ...keys];
}

/**
 * Rows whose name, sentence or other words hold every word of the query. A row
 * on a page the query names comes first, then one whose name holds it.
 */
export function searchSettings(
	query: string,
	index: readonly SettingResult[] = settingRows(),
): SettingResult[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const hay = (s: SettingResult) =>
		`${s.name} ${s.sentence} ${s.also ?? ""}`.toLowerCase();
	const first = words[0] as string;
	const score = (s: SettingResult) =>
		(PAGE_WORDS[s.tab].includes(first) ? 2 : 0) +
		(s.name.toLowerCase().includes(first) ? 1 : 0);
	return index
		.filter((s) => words.every((w) => hay(s).includes(w)))
		.map((s, i) => ({ s, i, score: score(s) }))
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map((r) => r.s);
}
