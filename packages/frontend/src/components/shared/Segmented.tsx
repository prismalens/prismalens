// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSlidingMark } from "@/hooks/use-sliding-mark";
import { cn } from "@/lib/utils";

/**
 * A view switch over the same data: a track one step above its ground and a
 * thumb two steps up that slides to the pressed option. No edge.
 */
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
	const { ref, box } = useSlidingMark<HTMLFieldSetElement>(
		'[aria-pressed="true"]',
	);
	return (
		<fieldset
			ref={ref}
			aria-label={label}
			className={cn(
				"relative flex w-fit items-center rounded-control bg-surface-2 p-0.5 [[data-pool]_&]:bg-well-in-pool [[role=dialog]_&]:bg-surface-3",
				className,
			)}
			data-testid={testId}
		>
			{box && (
				<span
					aria-hidden
					className="absolute top-0.5 bottom-0.5 left-0 rounded-[4px] bg-surface-4 transition-[translate,width] duration-(--dur-base) ease-(--ease-out)"
					style={{ translate: `${box.x}px 0`, width: box.w }}
				/>
			)}
			{options.map((o) => {
				const on = o.value === value;
				return (
					<button
						key={o.value}
						type="button"
						aria-pressed={on}
						className={cn(
							"relative z-10 inline-flex h-6 items-center rounded-[4px] px-2.5 text-body text-text-2 transition-colors duration-(--dur-fast) hover:text-text-1",
							on && "font-medium text-text-1",
						)}
						onClick={() => onChange(o.value)}
						data-testid={testId ? `${testId}-${o.value}` : undefined}
					>
						{o.label}
					</button>
				);
			})}
		</fieldset>
	);
}
