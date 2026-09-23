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
 * hairline between rows. Groups of these replace card stacks.
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
			className={cn("border-t py-3 first:border-t-0", className)}
			data-testid={testId}
		>
			<div className="flex items-center gap-4">
				<div className="min-w-0 flex-1">
					<div className="text-record font-medium">{label}</div>
					{description && (
						<div className="mt-0.5 text-meta text-muted-foreground">
							{description}
						</div>
					)}
				</div>
				{children && (
					<div className="flex shrink-0 items-center gap-2">{children}</div>
				)}
			</div>
			{below && <div className="mt-2">{below}</div>}
		</div>
	);
}

/** A titled group of setting rows. */
export function SettingGroup({
	title,
	description,
	children,
	className,
	testId,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section className={cn("space-y-2", className)} data-testid={testId}>
			<div>
				<h3 className="text-sm font-semibold tracking-tight">{title}</h3>
				{description && (
					<p className="text-meta text-muted-foreground">{description}</p>
				)}
			</div>
			<div className="rounded-md border px-4">{children}</div>
		</section>
	);
}
