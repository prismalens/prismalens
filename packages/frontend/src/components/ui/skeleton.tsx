// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

function Skeleton({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn("rounded-[6px] bg-surface-3", className)} {...props} />
	);
}

export { Skeleton };
