// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Tooltip as SdkTooltip,
	TooltipContent as SdkTooltipContent,
	TooltipTrigger as SdkTooltipTrigger,
} from "@ui-sdk/react/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

const Tooltip = SdkTooltip;
const TooltipTrigger = SdkTooltipTrigger;

const TooltipContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkTooltipContent>
>(({ className, sideOffset = 6, ...props }, ref) => (
	<SdkTooltipContent
		ref={ref}
		sideOffset={sideOffset}
		data-float="tip"
		className={cn(
			"pointer-events-none z-50 max-w-[280px] rounded-control bg-surface-4 px-2 py-1 text-meta text-text-1 shadow-float [@media(hover:none)]:hidden",
			className,
		)}
		{...props}
	/>
));
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipContent, TooltipTrigger };
