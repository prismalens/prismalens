// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ReactNode, useContext, useState } from "react";
import {
	InTooltipProvider,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The only tooltip (a DOM `title` is banned). One line, or a label and one
 * meta line; shortcuts live here and in the ? sheet, never on screen
 * (decision 9). `when={false}` skips it where the label is already visible.
 * `open` also shows it, for a trigger whose focus lands on a parent.
 */
export function Hint({
	label,
	meta,
	keys,
	side = "bottom",
	when = true,
	open = false,
	children,
}: {
	label: string;
	meta?: string;
	keys?: string[];
	side?: "top" | "bottom" | "left" | "right";
	when?: boolean;
	open?: boolean;
	children: ReactNode;
}) {
	const [hovered, setHovered] = useState(false);
	// Escape dismisses a hint the parent holds open, until `open` is let go.
	const [dismissed, setDismissed] = useState(false);
	const provided = useContext(InTooltipProvider);
	if (!open && dismissed) setDismissed(false);
	if (!when) return children;
	const tip = (
		<Tooltip
			disableHoverableContent
			open={hovered || (open && !dismissed)}
			onOpenChange={setHovered}
		>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side={side}
				data-testid="hint"
				onEscapeKeyDown={() => open && setDismissed(true)}
			>
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
	// Mounted outside the shell (a dialog's portal in a test, an island): bring the provider.
	return provided ? tip : <TooltipProvider>{tip}</TooltipProvider>;
}

/** Keys shown on a page that lists tools with their shortcuts (the New tab page, the palette). */
export function Keys({ keys }: { keys: string[] }) {
	return (
		<span className="flex shrink-0 gap-0.5" aria-hidden>
			{keys.map((k) => (
				<kbd
					key={k}
					className="min-w-5 rounded-[4px] bg-surface-3 px-1 text-center font-sans text-meta text-text-3"
				>
					{k}
				</kbd>
			))}
		</span>
	);
}
