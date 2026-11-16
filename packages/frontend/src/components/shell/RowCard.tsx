// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as P from "@radix-ui/react-popover";
import type { ReactNode, RefObject } from "react";
import { FAMILY_CLASS, SURFACE } from "@/components/kit/Popover";
import { cn } from "@/lib/utils";

/**
 * A sidebar row's peek or ask card, beside the row: placed at the row through a virtual
 * anchor, so the row draws without this code (#1101 category 12).
 */
export function RowCard({
	anchor,
	side,
	label,
	testId,
	onClose,
	children,
}: {
	anchor: RefObject<HTMLDivElement | null>;
	side: "right" | "bottom";
	label: string;
	testId: string;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<P.Root
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<P.Anchor
				virtualRef={anchor as RefObject<{ getBoundingClientRect(): DOMRect }>}
			/>
			<P.Portal>
				<P.Content
					side={side}
					align="start"
					sideOffset={6}
					collisionPadding={8}
					onOpenAutoFocus={(e) => e.preventDefault()}
					onCloseAutoFocus={(e) => e.preventDefault()}
					aria-label={label}
					data-float="pop"
					className={cn(SURFACE, FAMILY_CLASS.card, "p-2.5")}
					data-testid={testId}
				>
					{children}
				</P.Content>
			</P.Portal>
		</P.Root>
	);
}
