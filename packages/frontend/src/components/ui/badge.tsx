// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex h-5 items-center rounded-control px-1.5 text-meta font-medium",
	{
		variants: {
			variant: {
				default: "bg-surface-3 text-text-1",
				secondary: "bg-surface-3 text-text-2",
				destructive: "text-danger",
				outline: "text-text-2",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
