// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SquareTerminal, Star } from "lucide-react";
import { siClaudecode, siGooglegemini } from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Each agent's own mark (decision 20), from simple-icons (CC0 paths; the marks
 * stay their owners' trademarks, shown only to name the agent). Agents with no
 * mark that reads at 20 px get a two-letter tile until one is sourced.
 */
const MARKS: Record<string, { path: string; color: string }> = {
	"claude-code": { path: siClaudecode.path, color: `#${siClaudecode.hex}` },
	gemini: { path: siGooglegemini.path, color: `#${siGooglegemini.hex}` },
};

const LETTERS: Record<string, string> = {
	opencode: "OC",
	codex: "CX",
	deepagents: "DA",
};

export function AgentMark({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const mark = MARKS[id];
	const letters = LETTERS[id];
	if (letters)
		return (
			<span
				aria-hidden
				data-testid="agent-lettermark"
				className={cn(
					"inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-surface-4 text-[9px] leading-none font-semibold text-text-1 [&.size-5]:rounded-[5px] [&.size-5]:text-[10px]",
					className,
				)}
			>
				{letters}
			</span>
		);
	if (!mark)
		return (
			<SquareTerminal
				aria-hidden
				className={cn("size-4 shrink-0 text-text-1", className)}
				strokeWidth={1.75}
			/>
		);
	return (
		<svg
			aria-hidden
			viewBox="0 0 24 24"
			className={cn("size-4 shrink-0", className)}
			fill={mark.color}
		>
			<path d={mark.path} />
		</svg>
	);
}

/** The Starred tile's mark: the one star in the rail. */
export function StarredMark({ className }: { className?: string }) {
	return (
		<Star
			aria-hidden
			className={cn("size-4 shrink-0 fill-warn text-warn", className)}
		/>
	);
}
