// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A list screen's top row (study-v2 §2.5 rule 2): the area's title, its
 * controls, and the screen's own primary at the right, if it has one.
 */
export function PageHeader({
	title,
	children,
	primary,
	className,
}: {
	title: ReactNode;
	children?: ReactNode;
	/** The screen's one primary, if any. */
	primary?: ReactNode;
	className?: string;
}) {
	return (
		<header
			className={cn(
				"flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-surface-1 py-1.5 pr-3 pl-4",
				className,
			)}
			data-testid="page-header"
			data-title-row
		>
			<h1 className="mr-1 text-title">{title}</h1>
			{children}
			<span className="flex-1" />
			{primary}
		</header>
	);
}
