// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as P from "@radix-ui/react-popover";
import type { RefObject } from "react";

/**
 * A hint's floating half, loaded when a hint first shows (#1101 category 12): placed at its
 * trigger through a virtual anchor, so the trigger never sits inside this code.
 */
export function HintTip({
	id,
	anchor,
	side,
	label,
	meta,
	keys,
	onClose,
	onEscape,
}: {
	id: string;
	anchor: RefObject<HTMLElement | null>;
	side: "top" | "bottom" | "left" | "right";
	label: string;
	meta?: string;
	keys?: string[];
	onClose: () => void;
	onEscape: () => void;
}) {
	return (
		<P.Root
			open
			modal={false}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<P.Anchor
				virtualRef={anchor as RefObject<{ getBoundingClientRect(): DOMRect }>}
			/>
			<P.Portal>
				<P.Content
					id={id}
					role="tooltip"
					side={side}
					sideOffset={6}
					onOpenAutoFocus={(e) => e.preventDefault()}
					onCloseAutoFocus={(e) => e.preventDefault()}
					onEscapeKeyDown={onEscape}
					data-float="tip"
					className="pointer-events-none z-50 max-w-[280px] rounded-control bg-surface-4 px-2 py-1 text-meta text-text-1 shadow-float [@media(hover:none)]:hidden"
					data-testid="hint"
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
				</P.Content>
			</P.Portal>
		</P.Root>
	);
}
