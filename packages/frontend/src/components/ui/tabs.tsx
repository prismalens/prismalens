// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { useSlidingMark } from "@/hooks/use-sliding-mark";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
	const { ref: rowRef, box } = useSlidingMark<HTMLDivElement>(
		'[role="tab"][data-state="active"]',
	);
	return (
		<TabsPrimitive.List
			ref={(node) => {
				rowRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			}}
			className={cn(
				"relative inline-flex h-9 items-center gap-4 text-text-2",
				className,
			)}
			{...props}
		>
			{children}
			{box && (
				<span
					aria-hidden
					data-testid="tab-underline"
					className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent transition-[left,width] duration-(--dur-fast) ease-(--ease-standard)"
					style={{ left: box.x, width: box.w }}
				/>
			)}
		</TabsPrimitive.List>
	);
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"relative inline-flex h-9 items-center justify-center whitespace-nowrap text-body transition-colors duration-(--dur-fast) hover:text-text-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-medium data-[state=active]:text-text-1",
			className,
		)}
		{...props}
	/>
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn("mt-4", className)}
		{...props}
	/>
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
