// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** The agent's own words for why a run failed, under the sentence that explains them. */
export interface ErrorDetailData {
	text: string;
}

export const errorDetailBlock = define.block<ErrorDetailData>({
	id: "error.detail",
	label: "Error detail",
	copyLabel: "Copy error",
	text: (d) => d.text,
	source: () => ({ kind: "thread", item: "transcript" }),
	marks: ["break"],
	states: { default: "block-error-detail", phone: "block-error-detail" },
});
