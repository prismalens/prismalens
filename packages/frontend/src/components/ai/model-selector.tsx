// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * AI Elements ModelSelector (registry.ai-sdk.dev/model-selector.json, ai-elements 1.9.0), owned:
 * its cmdk parts inside `ui/popover`; the Logo parts hot-linked models.dev (#673).
 */
import type { ComponentProps } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function ModelSelector({
	className,
	...props
}: ComponentProps<typeof Command>) {
	return <Command className={cn("min-w-0", className)} {...props} />;
}

export function ModelSelectorInput(props: ComponentProps<typeof CommandInput>) {
	return <CommandInput {...props} />;
}

export function ModelSelectorList({
	className,
	...props
}: ComponentProps<typeof CommandList>) {
	return <CommandList className={cn("py-1", className)} {...props} />;
}

export function ModelSelectorEmpty(props: ComponentProps<typeof CommandEmpty>) {
	return <CommandEmpty {...props} />;
}

export function ModelSelectorGroup({
	className,
	...props
}: ComponentProps<typeof CommandGroup>) {
	return <CommandGroup className={cn("py-0", className)} {...props} />;
}

export function ModelSelectorItem({
	className,
	...props
}: ComponentProps<typeof CommandItem>) {
	return (
		<CommandItem
			className={cn("h-[52px] gap-2.5 px-3 py-2", className)}
			{...props}
		/>
	);
}
