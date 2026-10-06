// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Five roles (look ruling §2): primary is the one accent fill on a screen;
 * secondary is a step up, no edge; text is quiet; danger is a red word;
 * danger-fill exists only inside a destructive confirm.
 */
const PRIMARY =
	"bg-accent-solid text-accent-fg hover:bg-[oklch(from_var(--accent-solid)_calc(l_+_0.05)_c_h)]";
const SECONDARY = "bg-surface-3 text-text-1 hover:bg-surface-4";
const TEXT = "text-text-2 hover:bg-surface-3 hover:text-text-1";
const DANGER = "text-danger hover:bg-surface-3";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-body font-medium whitespace-nowrap transition-[background-color,color,transform] duration-(--dur-instant) ease-(--ease-standard) active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				primary: PRIMARY,
				secondary: SECONDARY,
				text: TEXT,
				danger: DANGER,
				"danger-fill":
					"bg-danger-solid text-accent-fg hover:bg-[oklch(from_var(--danger-solid)_calc(l_+_0.05)_c_h)]",
				/** @deprecated primary; the last look PR removes it. */
				default: PRIMARY,
				/** @deprecated secondary; the last look PR removes it. */
				outline: SECONDARY,
				/** @deprecated text; the last look PR removes it. */
				ghost: TEXT,
				/** @deprecated text; the last look PR removes it. */
				link: TEXT,
				/** @deprecated danger; the last look PR removes it. */
				destructive: DANGER,
			},
			size: {
				default: "h-7 px-2.5",
				xs: "h-6 gap-1 px-2 text-meta [&_svg:not([class*='size-'])]:size-3",
				sm: "h-6 gap-1 px-2 text-meta",
				lg: "h-8 px-3",
				icon: "size-7",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-6",
				"icon-lg": "size-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
