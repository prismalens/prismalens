// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { BlockSpec } from "@/components/kit/blocks";

/** A line of the report's evidence, such as a query, a metric or a log line it cites. */
export interface EvidenceData {
	text: string;
}

/** A command the report or a page suggests you run next, or a path to copy. */
export interface NextCommandData {
	command: string;
	/** A path, or a command this place only copies: no Send to terminal. */
	copyOnly?: boolean;
}

export const evidenceBlock: BlockSpec<EvidenceData> = {
	id: "report.evidence",
	label: "Evidence",
	copyLabel: "Copy evidence",
	text: (d) => d.text,
	source: () => ({ kind: "thread", item: "report" }),
	marks: [],
	states: { default: "block-evidence", phone: "block-evidence" },
};

export const nextCommandBlock: BlockSpec<NextCommandData> = {
	id: "next.command",
	label: "Next command",
	copyLabel: "Copy command",
	text: (d) => d.command,
	command: (d) => (d.copyOnly ? null : d.command),
	source: () => ({ kind: "thread", item: "report" }),
	marks: [],
	states: { default: "block-next-command", phone: "block-next-command" },
};
