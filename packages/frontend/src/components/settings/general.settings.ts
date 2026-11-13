// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const generalSidebar = define.setting({
	id: "general.sidebar",
	page: "general",
	anchor: "general-sidebar-row",
	label: "Sidebar",
	sentence: "Folded shows icons only. Press [ to hide it.",
	also: "layout",
});

export const generalSettleQuietThreads = define.setting({
	id: "general.settleQuietThreads",
	page: "general",
	anchor: "general-settle-row",
	label: "Settle quiet threads",
	sentence: "Moves a quiet thread to Settled and stops its watches.",
});

export const generalOpenFilesIn = define.setting({
	id: "general.openFilesIn",
	page: "general",
	anchor: "general-editor-row",
	label: "Open files in",
	sentence: "The editor a file link opens in.",
	also: "editor vscode",
});
