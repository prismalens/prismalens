// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Popover as SdkPopover,
	PopoverContent as SdkPopoverContent,
	PopoverTrigger as SdkPopoverTrigger,
} from "@ui-sdk/react/popover";
import * as React from "react";

import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";

const Popover = SdkPopover;

function PopoverTrigger({
	asChild = false,
	children,
	render,
	...props
}: React.ComponentProps<typeof SdkPopoverTrigger> & { asChild?: boolean }) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkPopoverTrigger render={resolvedRender} {...props}>
			{resolvedChildren}
		</SdkPopoverTrigger>
	);
}

const PopoverAnchor = ({ children }: { children?: React.ReactNode }) => (
	<>{children}</>
);

const PopoverContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkPopoverContent>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
	<SdkPopoverContent
		ref={ref}
		align={align}
		sideOffset={sideOffset}
		collisionPadding={titleRowHeight()}
		data-float="pop"
		className={cn(
			"floating z-50 w-72 rounded-pool p-3 text-text-1 outline-none",
			className,
		)}
		{...props}
	/>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
