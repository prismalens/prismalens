// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A table in a message: it scrolls sideways at the lane's width and copies as Markdown (#1101). */
export interface TableBlockData {
	markdown: () => string;
}

export const tableBlock = define.block<TableBlockData>({
	id: "table",
	label: "Table",
	copyLabel: "Copy as Markdown",
	fold: "read",
	text: (d) => d.markdown(),
	source: () => ({ kind: "thread", item: "transcript" }),
	marks: [],
	states: { default: "block-table", phone: "block-table" },
});
