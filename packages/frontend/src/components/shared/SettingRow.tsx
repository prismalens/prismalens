// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingRowProps {
	label: ReactNode;
	/** One line under the label: what the setting does or what it is set to. */
	description?: ReactNode;
	/** The control, right-aligned: a switch, a button, an input, a state word. */
	children?: ReactNode;
	/** Below the row, full width: an input that needs the room, an error. */
	below?: ReactNode;
	className?: string;
	testId?: string;
}

/**
 * One setting: label and meaning on the left, the control on the right, a
 * hairline between rows; on a phone the control drops under the label.
 * Groups of these replace card stacks.
 */
export function SettingRow({
	label,
	description,
	children,
	below,
	className,
	testId,
}: SettingRowProps) {
	return (
		<div
			className={cn(
				"border-t border-hairline py-2.5 first:border-t-0",
				className,
			)}
			data-testid={testId}
		>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
				<div className="min-w-0 flex-1">
					<div className="text-body text-text-1">{label}</div>
					{description && (
						<div className="mt-0.5 text-meta text-text-3">{description}</div>
					)}
				</div>
				{children && (
					<div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
						{children}
					</div>
				)}
			</div>
			{below && <div className="mt-2">{below}</div>}
		</div>
	);
}

/** A titled group of setting rows; a count and one quiet action beside the title. */
export function SettingGroup({
	title,
	count,
	actions,
	description,
	children,
	className,
	testId,
}: {
	title: string;
	count?: number;
	actions?: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section className={cn("mt-8 first:mt-0", className)} data-testid={testId}>
			<div className="mb-2">
				<div className="flex min-h-6 items-center justify-between gap-3">
					<h3 className="flex items-baseline gap-2 text-heading">
						{title}
						{count !== undefined && (
							<span className="font-normal text-text-3 tabular-nums">
								{count}
							</span>
						)}
					</h3>
					{actions}
				</div>
				{description && <p className="text-meta text-text-3">{description}</p>}
			</div>
			<div>{children}</div>
		</section>
	);
}
