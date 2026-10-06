// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A row of a list or a settings pool (look ruling §2): `[lead] [label / one
 * meta line] [trailing]`, at least 44 px, a hairline between rows and no
 * other line. In a Pool for settings; bare in a reading column.
 */
export function Row({
	lead,
	label,
	meta,
	trailing,
	below,
	stackOnPhone = false,
	className,
	testId,
}: {
	lead?: ReactNode;
	label: ReactNode;
	/** One line, ellipsised: what it is set to or what it does. */
	meta?: ReactNode;
	trailing?: ReactNode;
	/** Full width under the row: an input that needs the room, an error. */
	below?: ReactNode;
	/** On a phone the trailing control drops under the label. */
	stackOnPhone?: boolean;
	className?: string;
	testId?: string;
}) {
	return (
		<div
			className={cn(
				"min-w-0 border-t border-hairline py-2 first:border-t-0",
				className,
			)}
			data-testid={testId}
		>
			<div
				className={cn(
					"flex min-h-7 min-w-0 items-center gap-3",
					stackOnPhone && "max-sm:flex-col max-sm:items-stretch max-sm:gap-2",
				)}
			>
				{lead && (
					<span className="inline-flex w-4 shrink-0 justify-center">
						{lead}
					</span>
				)}
				<div className="min-w-0 flex-1">
					<div className="text-body text-text-1">{label}</div>
					{meta && (
						<div className="mt-px truncate text-meta text-text-3">{meta}</div>
					)}
				</div>
				{trailing && (
					<div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
						{trailing}
					</div>
				)}
			</div>
			{below && <div className="mt-2">{below}</div>}
		</div>
	);
}

/** A settings pool: one step above the canvas, radius 10, rows inside. */
export function Pool({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-pool=""
			className={cn("pool px-3.5 py-1", className)}
			{...props}
		/>
	);
}
