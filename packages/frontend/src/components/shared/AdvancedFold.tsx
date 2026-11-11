// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Settings rows nobody needs on day one, folded the same way on every page. */
export function AdvancedFold({
	description,
	children,
	testId,
	label = "Advanced",
}: {
	description?: ReactNode;
	children: ReactNode;
	testId?: string;
	label?: string;
}) {
	return (
		<details className="group mt-8" data-testid={testId}>
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-medium text-text-2 hover:text-text-1">
				<ChevronRight
					aria-hidden
					className="size-3.5 shrink-0 text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90 motion-reduce:transition-none"
				/>
				{label}
			</summary>
			{description ? (
				<p className="mt-1 mb-3 text-meta text-text-3">{description}</p>
			) : (
				<div className="mb-3" />
			)}
			{children}
		</details>
	);
}
