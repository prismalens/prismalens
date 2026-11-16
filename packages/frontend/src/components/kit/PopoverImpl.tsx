// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Hint } from "@/components/shared/Hint";
import { useMediaQuery } from "@/hooks/use-media-query";
import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { FAMILY_CLASS, type KitPopoverProps, SURFACE } from "./Popover";

// The popover's Radix half: loaded after a page's first content, or when one opens (#1101 category 12).

export function KitPopover({
	trigger,
	family,
	side = "bottom",
	align = "start",
	open,
	onOpenChange,
	label,
	hint,
	children,
	contentProps,
	defaultOpen,
}: KitPopoverProps & {
	/** Pressed before this code arrived: it opens as it mounts. */
	defaultOpen?: boolean;
}) {
	// Beside a row needs room; on a phone the card opens below its trigger.
	const roomy = useMediaQuery("(min-width: 640px)");
	const placed = side === "right" && !roomy ? "bottom" : side;
	const t = (
		<PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
	);
	return (
		<PopoverPrimitive.Root
			open={open}
			defaultOpen={defaultOpen}
			onOpenChange={onOpenChange}
		>
			{hint ? <Hint label={hint}>{t}</Hint> : t}
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					side={placed}
					align={align}
					sideOffset={6}
					collisionPadding={{ top: titleRowHeight(), bottom: 8, left: 8 }}
					aria-label={label}
					data-float="pop"
					data-family={family}
					className={cn(SURFACE, FAMILY_CLASS[family], "p-1")}
					{...contentProps}
				>
					{children}
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
