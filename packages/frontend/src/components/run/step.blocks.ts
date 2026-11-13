// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { define } from "@/registry/define";

/** A tool call's command line. */
export interface CommandData {
	command: string;
	/** A shell command, which Send to terminal may stage; other tools' calls are not. */
	shell: boolean;
}

/** What a tool call took in, or gave back. */
export interface ToolTextData {
	text: string;
}

export const commandBlock = define.block<CommandData>({
	id: "command",
	label: "Command",
	copyLabel: "Copy command",
	text: (d) => d.command,
	command: (d) => (d.shell ? d.command : null),
	source: () => ({ kind: "thread", item: "tool_output" }),
	marks: [],
	states: { default: "block-command", phone: "block-command" },
});

export const toolInputBlock = define.block<ToolTextData>({
	id: "tool.input",
	label: "Tool input",
	copyLabel: "Copy input",
	text: (d) => d.text,
	source: () => ({ kind: "thread", item: "tool_output" }),
	marks: [],
	states: { default: "block-tool-output", phone: "block-tool-output" },
});

export const toolOutputBlock = define.block<ToolTextData>({
	id: "tool.output",
	label: "Tool output",
	copyLabel: "Copy output",
	text: (d) => d.text,
	source: () => ({ kind: "thread", item: "tool_output" }),
	marks: [],
	states: { default: "block-tool-output", phone: "block-tool-output" },
});

/** A failed call's output: what it wrote to stderr, or the last of its log. */
export const logTailBlock = define.block<ToolTextData>({
	id: "log.tail",
	label: "Error output",
	copyLabel: "Copy output",
	text: (d) => d.text,
	source: () => ({ kind: "thread", item: "tool_output" }),
	marks: ["run"],
	states: { default: "block-log-tail", phone: "block-log-tail" },
});
