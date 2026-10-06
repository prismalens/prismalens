// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The only tooltip (a DOM `title` is banned). One line, or a label and one
 * meta line; shortcuts live here and in the ? sheet, never on screen
 * (decision 9). `when={false}` skips it where the label is already visible.
 */
export function Hint({
	label,
	meta,
	keys,
	side = "bottom",
	when = true,
	children,
}: {
	label: string;
	meta?: string;
	keys?: string[];
	side?: "top" | "bottom" | "left" | "right";
	when?: boolean;
	children: ReactNode;
}) {
	if (!when) return children;
	return (
		<Tooltip disableHoverableContent>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side} data-testid="hint">
				<span className="flex items-center gap-2">
					<span className="min-w-0">{label}</span>
					{keys?.map((k) => (
						<kbd
							key={k}
							className="font-mono text-meta font-medium text-text-2"
							data-testid="hint-key"
						>
							{k}
						</kbd>
					))}
				</span>
				{meta && (
					<span className="block text-text-2" data-testid="hint-meta">
						{meta}
					</span>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
