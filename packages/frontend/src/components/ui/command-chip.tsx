// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Block } from "@/components/kit/Block";
import { nextCommandBlock } from "@/components/run/report.blocks";
import { cn } from "@/lib/utils";

/**
 * A command (or a path) to copy and run yourself (#848): the `next.command`
 * block, with Send to terminal where a terminal can open (#931). `run` replaces it.
 */
export function CommandChip({
	command,
	display,
	run,
	path = false,
	wrap = false,
	className,
	testId = "command-chip",
}: {
	command: string;
	/** Shown in place of `command`; Copy and Run in terminal still use `command`. */
	display?: string;
	run?: ReactNode;
	/** A path to copy, not a command: no Run in terminal. */
	path?: boolean;
	/** Show the whole command over several lines instead of truncating it. */
	wrap?: boolean;
	className?: string;
	testId?: string;
}) {
	return (
		<Block
			spec={nextCommandBlock}
			data={{ command, copyOnly: path || !!run }}
			testId={testId}
		>
			{(chrome) => (
				<div
					className={cn(
						"flex min-w-0 items-center gap-2 rounded-control bg-well-in-pool py-1 pr-1 pl-2.5",
						className,
					)}
				>
					<code
						className={cn(
							"min-w-0 flex-1 font-mono text-mono text-text-1",
							wrap
								? "whitespace-pre-wrap [overflow-wrap:anywhere]"
								: "truncate",
						)}
					>
						{display ?? command}
					</code>
					{run}
					{chrome}
				</div>
			)}
		</Block>
	);
}
