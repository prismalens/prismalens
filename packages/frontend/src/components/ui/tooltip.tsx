// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/** The app's tooltip timing; the shell's provider and any fallback use the same. */
export const TIP_DELAY = {
	delayDuration: 400,
	skipDelayDuration: 200,
} as const;

/** True under a `TooltipProvider`, so a hint mounted outside one can bring its own. */
export const InTooltipProvider = React.createContext(false);

function TooltipProvider({
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider {...TIP_DELAY} {...props}>
			<InTooltipProvider.Provider value={true}>
				{children}
			</InTooltipProvider.Provider>
		</TooltipPrimitive.Provider>
	);
}

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
	React.ElementRef<typeof TooltipPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
	<TooltipPrimitive.Portal>
		<TooltipPrimitive.Content
			ref={ref}
			sideOffset={sideOffset}
			data-float="tip"
			className={cn(
				"pointer-events-none z-50 max-w-[280px] rounded-control bg-surface-4 px-2 py-1 text-meta text-text-1 shadow-float [@media(hover:none)]:hidden",
				className,
			)}
			{...props}
		/>
	</TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
