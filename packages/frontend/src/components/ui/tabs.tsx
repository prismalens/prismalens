// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Tabs as SdkTabs,
	TabsList as SdkTabsList,
	TabsPanel as SdkTabsPanel,
	TabsTab as SdkTabsTab,
} from "@ui-sdk/react/tabs";
import * as React from "react";

import { useSlidingMark } from "@/hooks/use-sliding-mark";
import { cn } from "@/lib/utils";

function Tabs({
	onValueChange,
	...props
}: Omit<React.ComponentProps<typeof SdkTabs<string>>, "onValueChange"> & {
	onValueChange?: (value: string) => void;
}) {
	return (
		<SdkTabs<string>
			onValueChange={
				onValueChange
					? (v) => {
							if (v !== null) onValueChange(v);
						}
					: undefined
			}
			{...props}
		/>
	);
}

const TabsList = React.forwardRef<
	HTMLDivElement,
	Omit<React.ComponentProps<typeof SdkTabsList>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, children, ...props }, ref) => {
	const { ref: rowRef, box } = useSlidingMark<HTMLDivElement>(
		'[role="tab"][data-selected]',
	);
	return (
		<SdkTabsList
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
		</SdkTabsList>
	);
});
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<typeof SdkTabsTab>
>(({ className, ...props }, ref) => (
	<SdkTabsTab
		ref={ref}
		className={cn(
			"relative inline-flex h-9 items-center justify-center whitespace-nowrap text-body transition-colors duration-(--dur-fast) hover:text-text-1 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 data-selected:font-medium data-selected:text-text-1",
			className,
		)}
		{...props}
	/>
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkTabsPanel>
>(({ className, ...props }, ref) => (
	<SdkTabsPanel ref={ref} className={cn("mt-4", className)} {...props} />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsContent, TabsList, TabsTrigger };
