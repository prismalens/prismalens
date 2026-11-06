// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

/** Work in progress: a ring with one turning arc, never a rotating icon. */
export function Ring({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 16 16"
			aria-hidden
			className={cn("ring-spin size-3 shrink-0 text-live", className)}
		>
			<circle
				cx="8"
				cy="8"
				r="6"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.25"
				strokeWidth="2"
			/>
			<path
				d="M8 2a6 6 0 0 1 6 6"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}
