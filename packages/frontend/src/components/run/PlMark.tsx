// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

/**
 * PrismaLens's mark on a line its own tools made (sheet §2): the lens glyph in
 * the line's icon colour, never a filled tile (colour is for status, §0.6).
 */
export function PlMark({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex size-3.5 shrink-0 items-center justify-center",
				className,
			)}
			data-testid="pl-mark"
		>
			<svg viewBox="0 0 256 256" className="size-3.5" aria-hidden>
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
