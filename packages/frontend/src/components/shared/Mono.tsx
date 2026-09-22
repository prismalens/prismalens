// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Every identifier and value in the app reads in the mono face with tabular figures:
 * incident numbers, timestamps, tool names, durations, versions, hashes.
 */
export function Mono({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn("font-mono tabular-nums tracking-tight", className)}
			{...props}
		/>
	);
}
