// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A small set of views, one pressed: the incidents overview's Window | Analytics shape. */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
	className,
	testId,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	label: string;
	className?: string;
	testId?: string;
}) {
	return (
		<fieldset
			aria-label={label}
			className={cn(
				"flex items-center rounded-control bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--raised-edge)]",
				className,
			)}
			data-testid={testId}
		>
			{options.map((o) => (
				<Button
					key={o.value}
					variant="ghost"
					size="xs"
					aria-pressed={o.value === value}
					className={cn(
						"h-6 rounded-[4px] px-2.5 text-body",
						o.value === value &&
							"bg-surface-4 font-medium text-text-1 hover:bg-surface-4",
					)}
					onClick={() => onChange(o.value)}
					data-testid={testId ? `${testId}-${o.value}` : undefined}
				>
					{o.label}
				</Button>
			))}
		</fieldset>
	);
}
