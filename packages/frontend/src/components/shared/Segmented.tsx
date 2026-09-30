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
				"flex items-center gap-0.5 rounded-md border p-0.5",
				className,
			)}
			data-testid={testId}
		>
			{options.map((o) => (
				<Button
					key={o.value}
					variant={o.value === value ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={o.value === value}
					className="h-5 text-meta"
					onClick={() => onChange(o.value)}
					data-testid={testId ? `${testId}-${o.value}` : undefined}
				>
					{o.label}
				</Button>
			))}
		</fieldset>
	);
}
