// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { useMediaQuery } from "@/hooks/use-media-query";
import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * One width per family (pattern sheet §0.5): menus 220, pickers and the
 * details card 280, an ask beside a row 320. A caller picks the family,
 * never a width.
 */
export const POPOVER_WIDTH = { menu: 220, picker: 280, card: 320 } as const;
export type PopoverFamily = keyof typeof POPOVER_WIDTH;

export const FAMILY_CLASS: Record<PopoverFamily, string> = {
	menu: "w-[220px]",
	picker: "w-[280px]",
	card: "w-[320px]",
};

/** Content sits on the shared floating surface; from the composer it opens up. */
export const SURFACE =
	"floating z-50 max-h-(--radix-popper-available-height) overflow-y-auto rounded-pool text-text-1 outline-none";

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
}: {
	trigger: ReactNode;
	family: PopoverFamily;
	/** `top` from the composer, `right` beside a sidebar row, `bottom` everywhere else. */
	side?: "top" | "bottom" | "right";
	align?: "start" | "center" | "end";
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** The surface's accessible name. */
	label: string;
	/** A tooltip on the trigger, for an icon-only trigger. */
	hint?: string;
	children: ReactNode;
	contentProps?: Omit<
		ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>,
		"side" | "align" | "className"
	>;
}) {
	// Beside a row needs room; on a phone the card opens below its trigger.
	const roomy = useMediaQuery("(min-width: 640px)");
	const placed = side === "right" && !roomy ? "bottom" : side;
	const t = (
		<PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
	);
	return (
		<PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
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
