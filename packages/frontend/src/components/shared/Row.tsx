// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A row of a settings pool, T3's rhythm (#673 w4): `[lead] [label / meta]
 * [trailing]`, at least 64 px, label 13/600, meta 12 px in two lines at most
 * inside 36rem, the control right and centred; a hairline between rows.
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
				"flex min-h-16 min-w-0 flex-col justify-center border-t border-hairline py-3 first:border-t-0",
				className,
			)}
			data-testid={testId}
		>
			<div
				className={cn(
					"flex min-w-0 items-center gap-4",
					stackOnPhone && "max-sm:flex-col max-sm:items-stretch max-sm:gap-2",
				)}
			>
				{lead && (
					<span className="inline-flex w-5 shrink-0 justify-center">
						{lead}
					</span>
				)}
				<div className="min-w-0 max-w-[36rem] flex-1">
					<div className="text-heading text-text-1">{label}</div>
					{meta && (
						<div className="mt-0.5 line-clamp-2 text-meta text-text-2">
							{meta}
						</div>
					)}
				</div>
				{trailing && (
					<div className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0 sm:flex-nowrap sm:justify-end">
						{trailing}
					</div>
				)}
			</div>
			{below && <div className="mt-2">{below}</div>}
		</div>
	);
}

/** A settings pool: one step above the canvas, radius 10, rows inside 16 px. */
export function Pool({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div data-pool="" className={cn("pool px-4", className)} {...props} />;
}
