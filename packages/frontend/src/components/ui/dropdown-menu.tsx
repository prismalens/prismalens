// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	Menu as SdkMenu,
	MenuCheckboxItem as SdkMenuCheckboxItem,
	MenuContent as SdkMenuContent,
	MenuGroup as SdkMenuGroup,
	MenuGroupLabel as SdkMenuGroupLabel,
	MenuItem as SdkMenuItem,
	MenuItemIndicator as SdkMenuItemIndicator,
	MenuRadioGroup as SdkMenuRadioGroup,
	MenuRadioItem as SdkMenuRadioItem,
	MenuSeparator as SdkMenuSeparator,
	MenuShortcut as SdkMenuShortcut,
	MenuSub as SdkMenuSub,
	MenuSubContent as SdkMenuSubContent,
	MenuSubTrigger as SdkMenuSubTrigger,
	MenuTrigger as SdkMenuTrigger,
} from "@ui-sdk/react/menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import * as React from "react";

import { titleRowHeight } from "@/lib/desktop";
import { cn } from "@/lib/utils";

function DropdownMenu({ ...props }: React.ComponentProps<typeof SdkMenu>) {
	return <SdkMenu {...props} />;
}

function DropdownMenuPortal({ children }: { children?: React.ReactNode }) {
	return <>{children}</>;
}

function DropdownMenuTrigger({
	asChild = false,
	children,
	render,
	...props
}: React.ComponentProps<typeof SdkMenuTrigger> & { asChild?: boolean }) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;
	return (
		<SdkMenuTrigger render={resolvedRender} {...props}>
			{resolvedChildren}
		</SdkMenuTrigger>
	);
}

function DropdownMenuContent({
	className,
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof SdkMenuContent>) {
	return (
		<SdkMenuContent
			data-float="pop"
			sideOffset={sideOffset}
			collisionPadding={titleRowHeight()}
			className={cn(
				"z-50 max-h-(--available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-pool floating p-1 text-text-1",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuGroup({
	...props
}: React.ComponentProps<typeof SdkMenuGroup>) {
	return <SdkMenuGroup {...props} />;
}

function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	asChild = false,
	children,
	render,
	onClick,
	onSelect,
	...props
}: Omit<React.ComponentProps<typeof SdkMenuItem>, "onSelect"> & {
	inset?: boolean;
	variant?: "default" | "destructive";
	asChild?: boolean;
	onSelect?: () => void;
	onClick?: React.MouseEventHandler<HTMLElement>;
}) {
	const resolvedRender =
		render ??
		(asChild && React.isValidElement(children) ? children : undefined);
	const resolvedChildren =
		asChild && React.isValidElement(children) ? undefined : children;

	return (
		<SdkMenuItem
			data-inset={inset || undefined}
			data-variant={variant}
			destructive={variant === "destructive"}
			render={resolvedRender}
			onSelect={onSelect}
			onClick={onClick}
			className={cn(
				"relative flex cursor-default items-center gap-2 h-8 rounded-control px-2 text-body outline-hidden select-none data-highlighted:bg-surface-3 data-highlighted:text-text-1 data-disabled:pointer-events-none data-disabled:opacity-50 data-inset:pl-8 data-[variant=destructive]:text-danger data-[variant=destructive]:data-highlighted:text-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-2 data-[variant=destructive]:*:[svg]:text-danger!",
				className,
			)}
			{...props}
		>
			{resolvedChildren}
		</SdkMenuItem>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	...props
}: Omit<React.ComponentProps<typeof SdkMenuCheckboxItem>, "children"> & {
	children?: React.ReactNode;
}) {
	return (
		<SdkMenuCheckboxItem
			className={cn(
				"relative flex cursor-default items-center gap-2 h-8 rounded-control pr-2 pl-8 text-body outline-hidden select-none data-highlighted:bg-surface-3 data-highlighted:text-text-1 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			checked={checked}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<SdkMenuItemIndicator>
					<CheckIcon className="size-4" aria-hidden="true" />
				</SdkMenuItemIndicator>
			</span>
			{children}
		</SdkMenuCheckboxItem>
	);
}

function DropdownMenuRadioGroup({
	...props
}: React.ComponentProps<typeof SdkMenuRadioGroup<string>>) {
	return <SdkMenuRadioGroup<string> {...props} />;
}

function DropdownMenuRadioItem({
	className,
	children,
	...props
}: Omit<React.ComponentProps<typeof SdkMenuRadioItem>, "children"> & {
	children?: React.ReactNode;
}) {
	return (
		<SdkMenuRadioItem
			className={cn(
				"relative flex cursor-default items-center gap-2 h-8 rounded-control pr-2 pl-8 text-body outline-hidden select-none data-highlighted:bg-surface-3 data-highlighted:text-text-1 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
				<SdkMenuItemIndicator>
					<CircleIcon className="size-2 fill-current" aria-hidden="true" />
				</SdkMenuItemIndicator>
			</span>
			{children}
		</SdkMenuRadioItem>
	);
}

function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<typeof SdkMenuGroupLabel> & {
	inset?: boolean;
}) {
	return (
		<SdkMenuGroupLabel
			data-inset={inset || undefined}
			className={cn(
				"px-2 py-1.5 text-meta text-text-3 data-inset:pl-8",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof SdkMenuSeparator>) {
	return (
		<SdkMenuSeparator
			className={cn("-mx-1 my-1 h-px bg-hairline", className)}
			{...props}
		/>
	);
}

function DropdownMenuShortcut({
	className,
	...props
}: React.ComponentProps<typeof SdkMenuShortcut>) {
	return (
		<SdkMenuShortcut
			className={cn("ml-auto text-meta text-text-3", className)}
			{...props}
		/>
	);
}

function DropdownMenuSub({
	...props
}: React.ComponentProps<typeof SdkMenuSub>) {
	return <SdkMenuSub {...props} />;
}

function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: Omit<React.ComponentProps<typeof SdkMenuSubTrigger>, "children"> & {
	inset?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<SdkMenuSubTrigger
			data-inset={inset || undefined}
			className={cn(
				"flex cursor-default items-center gap-2 h-8 rounded-control px-2 text-body outline-hidden select-none data-highlighted:bg-surface-3 data-highlighted:text-text-1 data-inset:pl-8 data-open:bg-surface-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-2",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4" aria-hidden="true" />
		</SdkMenuSubTrigger>
	);
}

function DropdownMenuSubContent({
	className,
	...props
}: React.ComponentProps<typeof SdkMenuSubContent>) {
	return (
		<SdkMenuSubContent
			data-float="pop"
			className={cn(
				"z-50 min-w-[8rem] overflow-hidden rounded-pool floating p-1 text-text-1",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
