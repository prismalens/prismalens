// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lines a text takes at about `perLine` characters a line; no layout is read. */
export function estimateLines(text: string, perLine = 80): number {
	let n = 0;
	for (const l of text.split("\n"))
		n += Math.max(1, Math.ceil(l.length / perLine));
	return n;
}

const CLAMP: Record<number, string> = {
	3: "line-clamp-3",
	6: "line-clamp-6",
};

/** A text past `lines` lines shows that many and Show more (#1101 cat 12 item 6). */
export function Clamp({
	lines,
	over,
	open,
	onToggle,
	children,
	testId,
}: {
	lines: 3 | 6;
	/** Whether the text runs past `lines`; false draws it whole with no control. */
	over: boolean;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
	testId?: string;
}) {
	if (!over) return <>{children}</>;
	return (
		<div data-testid={testId} data-open={open || undefined}>
			<div className={cn(!open && CLAMP[lines])}>{children}</div>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="mt-1 min-h-6 text-meta text-text-3 hover:text-text-1 max-md:min-h-11"
				data-testid="clamp-toggle"
			>
				{open ? "Show less" : "Show more"}
			</button>
		</div>
	);
}
