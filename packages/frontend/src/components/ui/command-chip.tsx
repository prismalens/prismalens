// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { cn } from "@/lib/utils";

/**
 * A command (or a path) to copy and run yourself (#848): the text in mono and
 * Copy. `run` is the empty slot the integrated terminal fills (#931).
 */
export function CommandChip({
	command,
	run,
	className,
	testId = "command-chip",
}: {
	command: string;
	run?: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-2 rounded-control bg-well-in-pool py-1 pr-1 pl-2.5",
				className,
			)}
			data-testid={testId}
		>
			<code className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
				{command}
			</code>
			{run}
			<CopyButton value={command} />
		</div>
	);
}
