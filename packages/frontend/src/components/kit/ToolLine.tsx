// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight, type LucideIcon, Wrench, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { logTailBlock, toolOutputBlock } from "@/components/run/step.blocks";
import { Ring } from "@/components/shared/Ring";
import { cn } from "@/lib/utils";
import { Block } from "./Block";

export interface ToolCall {
	id: string;
	/** Lucide icon by kind; a PrismaLens action passes the mark as `mark`. */
	icon?: LucideIcon;
	mark?: ReactNode;
	/** Past tense when ended ("Read", "Ran"), present while running ("Running"). */
	verb: string;
	/** The file, command or query; commands and paths read in mono. */
	subject?: string;
	mono?: boolean;
	running?: boolean;
	/** One line, shown in the error colour after the subject. */
	failed?: string;
	/** Plain text shown indented under the line when opened. */
	output?: string;
}

// Disclosure rows take 44 px on phones, under the 48 px rule tokens.css gives buttons (#1101).
const LINE =
	"group/line flex h-7 max-md:h-auto max-md:min-h-11! w-full min-w-0 items-center gap-2 rounded-control text-left text-body text-text-2 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent";

function Chevron({ open }: { open: boolean }) {
	return (
		<ChevronRight
			aria-hidden
			className={cn(
				"size-3.5 shrink-0 text-text-3 opacity-0 transition-transform duration-(--dur-fast) group-hover/line:opacity-100 group-focus-visible/line:opacity-100",
				open && "rotate-90 opacity-100",
			)}
		/>
	);
}

/**
 * One action as one flat line (pattern sheet §2): icon, verb, subject,
 * chevron. No frame, no step number; the output opens indented under it
 * and pushes only what follows, because the user asked for it.
 */
export function ToolLine({
	call,
	defaultOpen = false,
}: {
	call: ToolCall;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const outputId = useId();
	const Icon = call.icon ?? Wrench;
	const canOpen = Boolean(call.output);
	const head = (
		<>
			<span
				className={cn(
					"flex size-3.5 shrink-0 items-center justify-center",
					call.failed ? "text-danger" : "text-text-3",
				)}
			>
				{call.running ? (
					<Ring className="size-3.5" />
				) : call.failed ? (
					<X aria-label="Failed" className="size-3.5 stroke-[2]" />
				) : (
					(call.mark ?? <Icon aria-hidden className="size-3.5 stroke-[1.75]" />)
				)}
			</span>
			<span className="shrink-0">{call.verb}</span>
			{call.subject && (
				<span
					className={cn("min-w-0 truncate", call.mono && "font-mono text-mono")}
				>
					{call.subject}
				</span>
			)}
			{call.failed && (
				<span className="min-w-0 shrink-[2] truncate text-danger">
					{call.failed}
				</span>
			)}
			<span className="flex-1" />
			{canOpen && <Chevron open={open} />}
		</>
	);
	return (
		<div className="min-w-0" data-testid="tool-line" data-open={open}>
			{canOpen ? (
				<button
					type="button"
					className={LINE}
					aria-expanded={open}
					aria-controls={outputId}
					onClick={() => setOpen(!open)}
				>
					{head}
				</button>
			) : (
				<div className={LINE}>{head}</div>
			)}
			{open && call.output && (
				<div id={outputId} className="pb-1 pl-[22px]">
					<Block
						spec={call.failed ? logTailBlock : toolOutputBlock}
						data={{ text: call.output }}
					>
						<pre className="max-h-[320px] overflow-auto pr-8 font-mono text-mono whitespace-pre-wrap text-text-2">
							{call.output}
						</pre>
					</Block>
				</div>
			)}
		</div>
	);
}

/**
 * Consecutive actions folded into one line: "Ran 4 commands, read 3 files".
 * The summary comes from the caller (lib/investigation-events `summarizeTools`).
 */
export function ToolGroup({
	summary,
	calls,
	icon,
	defaultOpen = false,
}: {
	summary: string;
	calls: ToolCall[];
	icon?: LucideIcon;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const listId = useId();
	const Icon = icon ?? Wrench;
	const running = calls.some((c) => c.running);
	const failed = calls.filter((c) => c.failed).length;
	if (calls.length === 1) return <ToolLine call={calls[0]} />;
	return (
		<div className="min-w-0" data-testid="tool-group" data-open={open}>
			<button
				type="button"
				className={LINE}
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen(!open)}
			>
				<span className="flex size-3.5 shrink-0 items-center justify-center text-text-3">
					{running ? (
						<Ring className="size-3.5" />
					) : (
						<Icon aria-hidden className="size-3.5 stroke-[1.75]" />
					)}
				</span>
				<span className="min-w-0 truncate">
					{summary.charAt(0).toUpperCase() + summary.slice(1)}
				</span>
				{failed > 0 && (
					<span className="shrink-0 text-danger">{failed} failed</span>
				)}
				<span className="flex-1" />
				<Chevron open={open} />
			</button>
			{open && (
				<div id={listId} className="pl-[22px]">
					{calls.map((c) => (
						<ToolLine key={c.id} call={c} />
					))}
				</div>
			)}
		</div>
	);
}

/** The line and chevron, for transcript rows that carry more than a ToolCall (asks, flags). */
export { Chevron as ToolLineChevron, LINE as TOOL_LINE };
