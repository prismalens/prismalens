// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SquareTerminal, Star } from "lucide-react";
import { siClaude, siGooglegemini, siOpencode } from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Each agent's own mark (decision 20), from simple-icons (CC0 paths; the marks
 * stay their owners' trademarks, shown only to name the agent). Codex and
 * deepagents have no mark we may bundle (#1020), so they keep a two-letter tile.
 * A null color paints in the theme text color: the brand color is black.
 */
const MARKS: Record<string, { path: string; color: string | null }> = {
	opencode: { path: siOpencode.path, color: null },
	"claude-code": { path: siClaude.path, color: `#${siClaude.hex}` },
	gemini: { path: siGooglegemini.path, color: `#${siGooglegemini.hex}` },
};

const LETTERS: Record<string, string> = {
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
				data-letters={letters}
				className={cn(
					"after:content-[attr(data-letters)] inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-surface-4 text-[9px] leading-none font-semibold text-text-1 [&.size-5]:rounded-[5px] [&.size-5]:text-[10px]",
					className,
				)}
			/>
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
			className={cn("size-4 shrink-0", !mark.color && "text-text-1", className)}
			fill={mark.color ?? "currentColor"}
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
