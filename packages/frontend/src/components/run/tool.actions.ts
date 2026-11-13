// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronsDownUp, ChevronsUpDown, Copy, FileText } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** One tool call's row in the transcript. */
export interface ToolCtx {
	command: string;
	output: string;
	onToggle: () => void;
	onOpenFile?: () => void;
	facts: Facts<"open" | "hasOutput" | "hasFile">;
}

/** A turn's run of tool calls, folded to one line. */
export interface ToolGroupCtx {
	/** Every call's command, one per line. */
	commands: string;
	onToggle: () => void;
	facts: Facts<"open">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		tool: ToolCtx;
		toolGroup: ToolGroupCtx;
	}
	interface ObjectStates {
		tool: "open" | "hasOutput" | "hasFile";
		toolGroup: "open";
	}
	interface ActionObjects {
		"toolGroup.toggle": "toolGroup";
		"toolGroup.copyCommands": "toolGroup";
		"tool.toggle": "tool";
		"tool.copyCommand": "tool";
		"tool.copyOutput": "tool";
		"tool.openFile": "tool";
	}
}

export const toolToggle = defineAction({
	id: "tool.toggle",
	label: (c) => (c.facts.is?.open ? "Hide output" : "Show output"),
	icon: (c: ToolCtx) => (c.facts.is?.open ? ChevronsDownUp : ChevronsUpDown),
	run: (c) => c.onToggle(),
});

export const toolCopyCommand = defineAction({
	id: "tool.copyCommand",
	label: "Copy command",
	icon: Copy,
	run: (c) => void copyText(c.command),
});

export const toolCopyOutput = defineAction({
	id: "tool.copyOutput",
	label: "Copy output",
	icon: Copy,
	when: (f) => !!f.is?.hasOutput,
	run: (c) => void copyText(c.output),
});

export const toolOpenFile = defineAction({
	id: "tool.openFile",
	label: "Open the file",
	icon: FileText,
	when: (f) => !!f.is?.hasFile,
	run: (c) => c.onOpenFile?.(),
});

export const toolGroupToggle = defineAction({
	id: "toolGroup.toggle",
	label: (c) => (c.facts.is?.open ? "Hide steps" : "Show steps"),
	icon: (c: ToolGroupCtx) =>
		c.facts.is?.open ? ChevronsDownUp : ChevronsUpDown,
	run: (c) => c.onToggle(),
});

export const toolGroupCopyCommands = defineAction({
	id: "toolGroup.copyCommands",
	label: "Copy commands",
	icon: Copy,
	run: (c) => void copyText(c.commands),
});
