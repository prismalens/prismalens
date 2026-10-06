// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Vercel AI Elements' Tool (registry.ai-sdk.dev/tool.json), owned and
 * restyled (decision 14): a folded line per group of calls; open, each call
 * reads as the command or path that ran, its output in quiet mono, or the
 * gate's plain reason when it was not run.
 */
import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export const Tool = ({
	className,
	...props
}: ComponentProps<typeof Collapsible>) => (
	<Collapsible className={cn("group/tool min-w-0", className)} {...props} />
);

export const ToolHeader = ({
	children,
	aside,
}: {
	children: ReactNode;
	aside?: ReactNode;
}) => (
	<CollapsibleTrigger className="flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] text-meta text-text-3 outline-none hover:text-text-2 focus-visible:ring-2 focus-visible:ring-accent">
		<ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]/tool:rotate-90 motion-reduce:transition-none" />
		<span className="truncate">{children}</span>
		{aside}
	</CollapsibleTrigger>
);

export const ToolContent = ({
	className,
	...props
}: ComponentProps<typeof CollapsibleContent>) => (
	<CollapsibleContent
		className={cn(
			"mt-1 ml-1.5 border-l border-hairline pl-3.5 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
	/>
);

/** One call: what ran, then what it printed or why it was not run. */
export const ToolCall = ({
	command,
	output,
	refused,
	running,
}: {
	command: string;
	output?: string;
	refused?: string;
	running?: boolean;
}) => (
	<div className="min-w-0 py-1.5" data-testid="tool-call">
		<span
			className="block font-mono text-mono text-text-1 [overflow-wrap:anywhere]"
			data-testid="tool-command"
		>
			{command}
		</span>
		{refused ? (
			<p className="text-meta text-danger" data-testid="tool-refused">
				{refused}
			</p>
		) : running ? (
			<p className="text-meta text-text-3">Running</p>
		) : (
			output && (
				<pre className="line-clamp-3 font-mono text-[11.5px] leading-4 whitespace-pre-wrap text-text-3 [overflow-wrap:anywhere]">
					{output}
				</pre>
			)
		)}
	</div>
);
