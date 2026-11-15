// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ListFilter } from "lucide-react";
import { type ComponentProps, forwardRef } from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";

/** The list's filter as kept in the URL: `?state=needs&pr=failing` (#1101 cat 1.7). */
export interface ListFilterParams {
	state?: string;
	pr?: string;
}

/** The Filter icon, also drawn alone until the popover's code loads. */
export const FilterTrigger = forwardRef<
	HTMLButtonElement,
	ComponentProps<"button"> & { count: number }
>(function FilterTrigger({ count, className, ...props }, ref) {
	const label = count ? `Filter, ${count} on` : "Filter";
	return (
		<Hint label={label}>
			<button
				ref={ref}
				type="button"
				aria-label={label}
				className={cn(
					"flex h-6 items-center gap-1 rounded-control px-1.5 text-text-3 hover:bg-surface-3 hover:text-text-1 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center",
					count > 0 && "bg-surface-3 text-text-1",
					className,
				)}
				data-testid="sidebar-filter"
				data-count={count || undefined}
				{...props}
			>
				<ListFilter aria-hidden className="size-3" />
				{count > 0 && <span className="tabular-nums">{count}</span>}
			</button>
		</Hint>
	);
});
