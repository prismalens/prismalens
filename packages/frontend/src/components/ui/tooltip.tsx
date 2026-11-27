// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Tooltip as SdkTooltip,
	TooltipContent as SdkTooltipContent,
	TooltipTrigger as SdkTooltipTrigger,
} from "@ui-sdk/react/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

function TooltipProvider({
	children,
}: {
	children: React.ReactNode;
	delayDuration?: number;
	skipDelayDuration?: number;
}) {
	return <>{children}</>;
}

function Tooltip({
	disableHoverableContent: _disableHoverableContent,
	...props
}: React.ComponentProps<typeof SdkTooltip> & {
	disableHoverableContent?: boolean;
}) {
	return <SdkTooltip {...props} />;
}

function TooltipTrigger({
	asChild = false,
	children,
	render,
	...props
}: React.ComponentProps<typeof SdkTooltipTrigger> & { asChild?: boolean }) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkTooltipTrigger render={resolvedRender} {...props}>
			{resolvedChildren}
		</SdkTooltipTrigger>
	);
}

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

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
