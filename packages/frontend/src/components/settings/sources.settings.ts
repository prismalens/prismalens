// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

export const sourcesSources = define.setting({
	id: "sources.sources",
	page: "sources",
	label: "Sources",
	sentence: "What a run reads before it starts.",
	also: "integrations github prometheus",
});
