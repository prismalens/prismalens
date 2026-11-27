// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	ScrollArea as SdkScrollArea,
	ScrollAreaCorner as SdkScrollAreaCorner,
	ScrollAreaScrollbar as SdkScrollAreaScrollbar,
	ScrollAreaThumb as SdkScrollAreaThumb,
	ScrollAreaViewport as SdkScrollAreaViewport,
} from "@ui-sdk/react/scroll-area";
import * as React from "react";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkScrollArea>
>(({ className, children, ...props }, ref) => (
	<SdkScrollArea
		ref={ref}
		className={cn("relative overflow-hidden", className)}
		{...props}
	>
		<SdkScrollAreaViewport className="h-full w-full rounded-[inherit]">
			{children}
		</SdkScrollAreaViewport>
		<ScrollBar />
		<SdkScrollAreaCorner />
	</SdkScrollArea>
));
ScrollArea.displayName = "ScrollArea";

const ScrollBar = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
	<SdkScrollAreaScrollbar
		ref={ref}
		orientation={orientation}
		className={cn(
			"flex touch-none select-none transition-colors",
			orientation === "vertical" && "h-full w-2.5 p-px",
			orientation === "horizontal" && "h-2.5 flex-col p-px",
			className,
		)}
		{...props}
	>
		<SdkScrollAreaThumb className="relative flex-1 rounded-full bg-surface-4 hover:bg-text-3" />
	</SdkScrollAreaScrollbar>
));
ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
