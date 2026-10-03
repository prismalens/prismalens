// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SquareTerminal, Star } from "lucide-react";
import {
	siClaudecode,
	siGooglegemini,
	siLangchain,
	siOpencode,
} from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Each agent's own mark (decision 20), from simple-icons (CC0 paths; the marks
 * stay their owners' trademarks, shown only to name the agent). OpenAI asked
 * simple-icons to drop its mark, so Codex shows a terminal glyph instead.
 */
const MARKS: Record<string, { path: string; color: string | null }> = {
	opencode: { path: siOpencode.path, color: null },
	"claude-code": { path: siClaudecode.path, color: `#${siClaudecode.hex}` },
	gemini: { path: siGooglegemini.path, color: `#${siGooglegemini.hex}` },
	deepagents: { path: siLangchain.path, color: `#${siLangchain.hex}` },
};

export function AgentMark({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const mark = MARKS[id];
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
