// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Primary is the one accent fill on a screen; secondary is the hover surface
 * with no border; ghost is text; destructive fills red only inside its confirm.
 */
const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control text-body font-medium whitespace-nowrap transition-colors motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				default: "bg-accent text-accent-fg hover:bg-accent/90",
				destructive: "bg-danger text-accent-fg hover:bg-danger/90",
				danger: "text-danger hover:bg-surface-3",
				outline: "bg-surface-3 text-text-1 hover:bg-surface-4",
				secondary: "bg-surface-3 text-text-1 hover:bg-surface-4",
				ghost: "text-text-2 hover:bg-surface-3 hover:text-text-1",
				link: "text-accent underline-offset-4 hover:underline",
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
