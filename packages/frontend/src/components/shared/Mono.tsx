// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Identifiers read in the mono face: incident numbers, tool and metric names,
 * versions, hashes, keys. Dates, durations, counts and display names stay in
 * the sans face with `tabular-nums`.
 */
export function Mono({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn("font-mono tabular-nums tracking-tight", className)}
			{...props}
		/>
	);
}
