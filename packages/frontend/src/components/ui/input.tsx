// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
	({ className, type, ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(
					"flex h-8 w-full px-2.5 py-1 text-[16px] file:border-0 file:bg-transparent file:text-meta file:font-medium md:h-7 md:text-body raised rounded-control text-body text-text-1 placeholder:text-text-3 outline-none focus-visible:ring-2 focus-visible:ring-accent [[role=dialog]_&]:bg-surface-3 [[role=alertdialog]_&]:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				ref={ref}
				{...props}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input };
