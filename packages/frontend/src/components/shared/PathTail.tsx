// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

/**
 * A path or URL on one line that, when it does not fit, loses its start, not its
 * end: two clones differ in their last folder. The full value is the title.
 */
export function PathTail({
	path,
	className,
	testId,
}: {
	path: string;
	className?: string;
	testId?: string;
}) {
	return (
		<span
			dir="rtl"
			title={path}
			className={cn("block truncate text-left", className)}
			data-testid={testId}
		>
			<bdi dir="ltr">{path}</bdi>
		</span>
	);
}
