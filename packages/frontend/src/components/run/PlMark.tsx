// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

/** PrismaLens's mark on a row its own tools made (#1101 cat 9): the logo's lens glyph. */
export function PlMark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] bg-accent-solid text-accent-fg",
				className,
			)}
			data-testid="pl-mark"
			title="PrismaLens"
		>
			<svg viewBox="0 0 256 256" className="size-2.5" aria-hidden>
				<circle
					cx="142"
					cy="104"
					r="54"
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
				/>
				<line
					x1="88"
					y1="64"
					x2="88"
					y2="224"
					stroke="currentColor"
					strokeWidth="40"
					strokeLinecap="round"
				/>
			</svg>
		</span>
	);
}
