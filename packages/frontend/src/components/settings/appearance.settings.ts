// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const appearanceColorScheme = define.setting({
	id: "appearance.colorScheme",
	page: "appearance",
	anchor: "appearance-scheme",
	label: "Color scheme",
	sentence: "Light, dark or the system's.",
	also: "theme dark mode",
});

export const appearanceInterfaceFont = define.setting({
	id: "appearance.interfaceFont",
	page: "appearance",
	anchor: "appearance-font-row",
	label: "Interface font",
	sentence: "Everything except code, addresses and commands.",
	also: "typography",
});

/** The right panel's width, set by dragging its border (#1101 category 21 item 5). */
export const appearancePanelWidth = define.setting({
	id: "appearance.panelWidth",
	page: "appearance",
	label: "Side panel width",
	sentence:
		"Drag the side panel's border to set it; double-click the border to reset it.",
	also: "right panel pane width resize drag",
	key: "pl.panelWidth",
	scope: "person",
});

/** How much of a thread shows folded (#1101 category 12 item 6); the first option is the default. */
export const appearanceTranscriptView = define.setting({
	id: "appearance.transcriptView",
	page: "appearance",
	anchor: "appearance-transcript-view",
	label: "Thread view",
	sentence:
		"Focus shows your messages, each turn's summary and its answer; Full opens everything.",
	also: "fold collapse expand density transcript steps tools focus full",
	key: "pl.transcriptView",
	scope: "person",
	surfaces: ["message"],
	options: [
		{ value: "standard", label: "Standard" },
		{ value: "focus", label: "Focus" },
		{ value: "full", label: "Full" },
	],
});
