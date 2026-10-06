// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
	return (
		<textarea
			className={cn(
				"flex min-h-[64px] w-full px-2.5 py-1.5 text-[16px] md:text-body rounded-control bg-surface-2 text-body text-text-1 placeholder:text-text-3 [[data-pool]_&]:bg-well-in-pool [[data-pool]_&]:shadow-raised [[role=dialog]_&]:bg-surface-3 [[role=alertdialog]_&]:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			ref={ref}
			{...props}
		/>
	);
});
Textarea.displayName = "Textarea";

export { Textarea };
