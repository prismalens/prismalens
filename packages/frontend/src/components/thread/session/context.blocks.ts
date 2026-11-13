// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BlockSpec } from "@/components/kit/blocks";

/** The context breakdown as the lines it shows: one label and value per line. */
export interface ContextBreakdownData {
	lines: readonly string[];
}

export const contextBreakdownBlock: BlockSpec<ContextBreakdownData> = {
	id: "context.breakdown",
	label: "Context breakdown",
	copyLabel: "Copy breakdown",
	text: (d) => d.lines.join("\n"),
	marks: ["usage"],
	states: { default: "block-context", phone: "block-context" },
};
