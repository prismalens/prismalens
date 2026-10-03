// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RecordSectionProps extends HTMLAttributes<HTMLElement> {
	/** Anchor id, so a section is linkable from the rail and the composer. */
	id: string;
	title: string;
	/** A count beside the title, rendered in mono. Omitted when undefined. */
	count?: number;
	/** Right-aligned controls for the section: buttons, chips, a picker. */
	actions?: ReactNode;
	children: ReactNode;
}

/**
 * One section of the durable record. The heading is quiet on purpose: the record
 * reads as one document with named parts, not as a stack of cards.
 */
export function RecordSection({
	id,
	title,
	count,
	actions,
	className,
	children,
	...props
}: RecordSectionProps) {
	return (
		<section
			id={id}
			aria-labelledby={`${id}-title`}
			className={cn("mt-8 scroll-mt-24 first:mt-0", className)}
			{...props}
		>
			<div className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<h2
					id={`${id}-title`}
					className="flex shrink-0 items-baseline gap-2 text-heading text-text-1"
				>
					{title}
					{count !== undefined && (
						<span className="text-body font-normal text-text-3 tabular-nums">
							{count}
						</span>
					)}
				</h2>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
			{children}
		</section>
	);
}
