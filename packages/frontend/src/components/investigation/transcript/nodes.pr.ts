// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createElement } from "react";
import { lazyPart } from "@/lib/lazy";
import type { TranscriptNodeProps, TranscriptNodes } from "./types";

const LINE = "flex min-h-5 items-center text-meta text-text-2 tabular-nums";

/** Its code loads with the thread, off its first paint (#1181); the PR's name holds the line meanwhile. */
const PrStatusNode = lazyPart<TranscriptNodeProps>(
	() => import("./PrStatusNode").then((m) => m.PrStatusNode),
	({ event }) =>
		createElement(
			"span",
			{ className: LINE, "data-testid": "pr-status-loading" },
			(event as { pr?: string }).pr ?? "",
		),
	{
		failed: (retry) =>
			createElement(
				"button",
				{
					type: "button",
					onClick: retry,
					className: `${LINE} hover:text-text-1`,
					"data-testid": "pr-status-retry",
				},
				"PR status didn't load · Retry",
			),
	},
);

/** PR and checks' transcript nodes (#1101 category 15). Only that lane edits this file. */
export const prNodes = {
	pr_status: { Node: PrStatusNode },
} satisfies TranscriptNodes;
