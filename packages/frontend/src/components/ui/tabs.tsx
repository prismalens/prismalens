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

/**
 * Radix focuses a tab from its own mousedown, which Chromium then shows as
 * keyboard focus; `data-pointer` marks a pointer press so only keys show it.
 */
const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, onPointerDown, onKeyDown, onBlur, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"relative inline-flex h-9 items-center justify-center whitespace-nowrap text-body outline-none transition-colors duration-(--dur-fast) hover:text-text-1 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-50 data-[pointer]:outline-none! data-[state=active]:font-medium data-[state=active]:text-text-1",
			className,
		)}
		onPointerDown={(e) => {
			e.currentTarget.dataset.pointer = "";
			onPointerDown?.(e);
		}}
		onKeyDown={(e) => {
			delete e.currentTarget.dataset.pointer;
			onKeyDown?.(e);
		}}
		onBlur={(e) => {
			delete e.currentTarget.dataset.pointer;
			onBlur?.(e);
		}}
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
