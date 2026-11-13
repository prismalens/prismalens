// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A failing check's log excerpt, as the code host returned it. */
export interface CheckExcerptData {
	/** The check's name, which the quote carries. */
	name: string;
	lines: readonly string[];
}

export const checkExcerptBlock = define.block<CheckExcerptData>({
	id: "check.excerpt",
	label: "Check log",
	copyLabel: "Copy log",
	text: (d) => d.lines.join("\n"),
	source: (d) => ({ kind: "log", name: d.name }),
	marks: ["checks"],
	states: { default: "block-check-excerpt", phone: "block-check-excerpt" },
});
