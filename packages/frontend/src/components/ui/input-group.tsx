// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** shadcn `input-group` (shadcn@4.21.4), restyled: a surface-1 well, no outline or ring (#673). */
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="input-group"
			className={cn(
				"group/input-group relative flex w-full min-w-0 flex-col rounded-pool bg-surface-1",
				className,
			)}
			{...props}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"flex min-w-0 items-center gap-1 text-body text-text-2",
	{
		variants: {
			align: {
				"inline-start": "order-first",
				"inline-end": "order-last",
				"block-start": "order-first w-full",
				"block-end": "order-last w-full",
			},
		},
		defaultVariants: { align: "block-end" },
	},
);

function InputGroupAddon({
	className,
	align = "block-end",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
	return (
		<div
			data-slot="input-group-addon"
			data-align={align}
			className={cn(inputGroupAddonVariants({ align }), className)}
			{...props}
		/>
	);
}

function InputGroupButton({
	className,
	type = "button",
	variant = "text",
	...props
}: React.ComponentProps<typeof Button>) {
	return (
		<Button
			type={type}
			variant={variant}
			className={cn("h-8", className)}
			{...props}
		/>
	);
}

function InputGroupTextarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="input-group-control"
			className={cn(
				"block w-full min-w-0 resize-none bg-transparent text-body text-text-1 outline-none placeholder:text-text-3 disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea };
