// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	SegmentedControl,
	SegmentedControlIndicator,
	SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { cn } from "@/lib/utils";

/**
 * A view switch over the same data: a track one step above its ground and a
 * thumb two steps up that slides to the checked option. No edge.
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
	return (
		<SegmentedControl
			value={value}
			onValueChange={(v) => {
				if (v !== null) onChange(v as T);
			}}
			aria-label={label}
			className={cn(
				"relative isolate flex w-fit items-center rounded-control bg-surface-2 p-0.5 [[data-pool]_&]:bg-well-in-pool [[role=dialog]_&]:bg-surface-3",
				className,
			)}
			data-testid={testId}
		>
			<SegmentedControlIndicator
				aria-hidden
				className="pointer-events-none absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-[4px] bg-surface-4 transition-[left,width] duration-(--dur-base) ease-(--ease-out)"
			/>
			{options.map((o) => (
				<SegmentedControlItem
					key={o.value}
					value={o.value}
					className="relative z-10 inline-flex h-6 items-center rounded-[4px] px-2.5 text-body text-text-2 transition-colors duration-(--dur-fast) hover:text-text-1 data-checked:font-medium data-checked:text-text-1"
					data-testid={testId ? `${testId}-${o.value}` : undefined}
				>
					{o.label}
				</SegmentedControlItem>
			))}
		</SegmentedControl>
	);
}
