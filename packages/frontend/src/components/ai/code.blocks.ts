// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A fenced block in a message: its code, read from the drawn block when an action runs. */
export interface CodeBlockData {
	code: () => string;
	/** A one-line shell block the agent asks you to run. */
	command: string | null;
}

export const codeBlock = define.block<CodeBlockData>({
	id: "code",
	label: "Code",
	copyLabel: "Copy code",
	text: (d) => d.code(),
	command: (d) => d.command,
	source: () => ({ kind: "thread", item: "transcript" }),
	marks: [],
	states: { default: "block-code", phone: "block-code" },
});
