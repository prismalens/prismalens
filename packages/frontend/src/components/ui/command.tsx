// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Command as SdkCommand,
	CommandEmpty as SdkCommandEmpty,
	CommandGroup as SdkCommandGroup,
	CommandGroupLabel as SdkCommandGroupLabel,
	CommandInput as SdkCommandInput,
	CommandItem as SdkCommandItem,
	CommandList as SdkCommandList,
	CommandSeparator as SdkCommandSeparator,
} from "@ui-sdk/react/command";
import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Command({
	className,
	filter,
	...props
}: Omit<React.ComponentProps<typeof SdkCommand>, "filter"> & {
	filter?:
		| React.ComponentProps<typeof SdkCommand>["filter"]
		| ((value: string, query: string) => number);
}) {
	const resolvedFilter: React.ComponentProps<typeof SdkCommand>["filter"] =
		filter
			? (item, query) => {
					const fn = filter as (a: unknown, b: string) => boolean | number;
					const arg = typeof item === "string" ? item : item.value;
					return Boolean(fn(arg, query));
				}
			: undefined;

	return (
		<SdkCommand
			filter={resolvedFilter}
			className={cn(
				"flex h-full w-full flex-col overflow-hidden text-text-1",
				className,
			)}
			{...props}
		/>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof SdkCommandInput>) {
	return (
		<div
			data-slot="command-input-wrapper"
			className="flex h-10 shrink-0 items-center gap-2 px-3 text-text-3 shadow-[0_1px_0_var(--hairline)]"
		>
			<Search className="size-3.5 shrink-0" aria-hidden />
			<SdkCommandInput
				className={cn(
					"h-9 w-full min-w-0 bg-transparent text-body text-text-1 outline-none placeholder:text-text-3 disabled:cursor-not-allowed",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({
	className,
	label,
	...props
}: Omit<React.ComponentProps<typeof SdkCommandList>, "children"> & {
	label?: string;
	children?: React.ReactNode;
}) {
	return (
		<SdkCommandList
			aria-label={label}
			className={cn(
				"min-h-0 flex-1 scroll-py-1 overflow-x-hidden overflow-y-auto",
				className,
			)}
			{...props}
		/>
	);
}

function CommandEmpty({
	className,
	...props
}: Omit<React.ComponentProps<typeof SdkCommandEmpty>, "children"> & {
	children?: React.ReactNode;
}) {
	return (
		<SdkCommandEmpty
			className={cn("px-3 py-2 text-body text-text-2", className)}
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	heading,
	children,
	...props
}: Omit<React.ComponentProps<typeof SdkCommandGroup>, "children"> & {
	heading?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<SdkCommandGroup
			className={cn("overflow-hidden py-1", className)}
			{...props}
		>
			{heading && (
				<SdkCommandGroupLabel className="px-3 pt-2 pb-1 text-meta text-text-3">
					{heading}
				</SdkCommandGroupLabel>
			)}
			{children}
		</SdkCommandGroup>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof SdkCommandSeparator>) {
	return (
		<SdkCommandSeparator
			className={cn("mx-1.5 my-1 h-px bg-hairline", className)}
			{...props}
		/>
	);
}

function CommandItem({
	className,
	...props
}: Omit<React.ComponentProps<typeof SdkCommandItem>, "children"> & {
	children?: React.ReactNode;
}) {
	return (
		<SdkCommandItem
			className={cn(
				"relative flex cursor-default items-center gap-2 outline-none select-none transition-colors duration-(--dur-instant) hover:bg-surface-3 data-disabled:pointer-events-none data-disabled:text-text-3 data-highlighted:bg-surface-3 data-selected:bg-surface-3",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
};
