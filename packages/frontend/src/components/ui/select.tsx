// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Select as SdkSelect,
	SelectContent as SdkSelectContent,
	SelectGroup as SdkSelectGroup,
	SelectGroupLabel as SdkSelectGroupLabel,
	SelectItem as SdkSelectItem,
	SelectItemIndicator as SdkSelectItemIndicator,
	SelectItemText as SdkSelectItemText,
	SelectSeparator as SdkSelectSeparator,
	SelectTrigger as SdkSelectTrigger,
	SelectValue as SdkSelectValue,
} from "@ui-sdk/react/select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";

function Select({
	onValueChange,
	...props
}: Omit<
	React.ComponentProps<typeof SdkSelect<string, false>>,
	"onValueChange" | "multiple" | "value" | "defaultValue"
> & {
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
}) {
	return (
		<SdkSelect<string, false>
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

const SelectGroup = SdkSelectGroup;

const SelectValue = SdkSelectValue;

const SelectTrigger = React.forwardRef<
	HTMLButtonElement,
	Omit<React.ComponentProps<typeof SdkSelectTrigger>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, children, ...props }, ref) => (
	<SdkSelectTrigger
		ref={ref}
		className={cn(
			"inline-flex h-7 w-fit max-w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-control bg-surface-3 pr-2 pl-2.5 text-body font-medium text-text-1 transition-colors duration-(--dur-instant) hover:bg-surface-4 [[data-pool]_&]:bg-well-in-pool [[data-pool]_&]:shadow-raised [[data-pool]_&]:hover:bg-surface-4 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-placeholder:text-text-3 [&>span]:line-clamp-1",
			className,
		)}
		{...props}
	>
		{children}
		<ChevronDown className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
	</SdkSelectTrigger>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectScrollUpButton = (_props: React.HTMLAttributes<HTMLDivElement>) =>
	null;
SelectScrollUpButton.displayName = "SelectScrollUpButton";

const SelectScrollDownButton = (_props: React.HTMLAttributes<HTMLDivElement>) =>
	null;
SelectScrollDownButton.displayName = "SelectScrollDownButton";

const SelectContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkSelectContent> & {
		position?: "popper" | "item-aligned";
	}
>(({ className, children, position = "popper", ...props }, ref) => (
	<SdkSelectContent
		ref={ref}
		data-float="pop"
		className={cn(
			"relative z-50 max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] overflow-x-hidden overflow-y-auto rounded-pool floating p-1 text-text-1",
			position === "popper" &&
				"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
			className,
		)}
		collisionPadding={titleRowHeight()}
		alignItemWithTrigger={position === "item-aligned"}
		{...props}
	>
		{children}
	</SdkSelectContent>
));
SelectContent.displayName = "SelectContent";

const SelectLabel = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkSelectGroupLabel>
>(({ className, ...props }, ref) => (
	<SdkSelectGroupLabel
		ref={ref}
		className={cn("px-2 py-1.5 text-meta text-text-3", className)}
		{...props}
	/>
));
SelectLabel.displayName = "SelectLabel";

const SelectItem = React.forwardRef<
	HTMLDivElement,
	Omit<React.ComponentProps<typeof SdkSelectItem>, "children"> & {
		children?: React.ReactNode;
	}
>(({ className, children, ...props }, ref) => (
	<SdkSelectItem
		ref={ref}
		className={cn(
			"relative flex h-8 w-full cursor-default select-none items-center rounded-control pr-8 pl-2 text-body outline-none data-highlighted:bg-surface-3 data-highlighted:text-text-1 data-selected:bg-surface-3 data-disabled:pointer-events-none data-disabled:opacity-50",
			className,
		)}
		{...props}
	>
		<span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
			<SdkSelectItemIndicator>
				<Check
					className="size-3.5 text-accent"
					strokeWidth={2.5}
					aria-hidden="true"
				/>
			</SdkSelectItemIndicator>
		</span>
		<SdkSelectItemText>{children}</SdkSelectItemText>
	</SdkSelectItem>
));
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof SdkSelectSeparator>
>(({ className, ...props }, ref) => (
	<SdkSelectSeparator
		ref={ref}
		className={cn("-mx-1 my-1 h-px bg-hairline", className)}
		{...props}
	/>
));
SelectSeparator.displayName = "SelectSeparator";

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
