// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const generalSidebar = define.setting({
	id: "general.sidebar",
	page: "general",
	anchor: "general-layout",
	label: "Sidebar",
	sentence: "How the sidebar shows.",
	also: "layout",
});

export const generalSettleQuietThreads = define.setting({
	id: "general.settleQuietThreads",
	page: "general",
	anchor: "general-threads",
	label: "Settle quiet threads",
	sentence: "When a quiet thread settles by itself.",
});

export const generalOpenFilesIn = define.setting({
	id: "general.openFilesIn",
	page: "general",
	anchor: "general-files",
	label: "Open files in",
	sentence: "The editor a file link opens in.",
	also: "editor vscode",
});
