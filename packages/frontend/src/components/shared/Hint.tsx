// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

/** Shortcuts live here and in the ? sheet, never on screen (decision 9). */
export function Hint({
	label,
	keys,
	side = "bottom",
	children,
}: {
	label: string;
	keys?: string[];
	side?: "top" | "bottom" | "left" | "right";
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side} data-testid="hint">
				<span className="flex items-center gap-2">
					{label}
					{keys?.map((k) => (
						<kbd
							key={k}
							className="font-mono text-meta text-text-3"
							data-testid="hint-key"
						>
							{k}
						</kbd>
					))}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
