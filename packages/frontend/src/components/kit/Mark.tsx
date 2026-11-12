// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { cn } from "@/lib/utils";
import { type MarkId, markLook } from "./marks";

/**
 * One mark from `marks.ts` (sheet §0.7): its icon tinted for the state, the
 * word in a hint and the accessible name. `children` is a count beside it.
 */
export function Mark({
	id,
	state,
	word,
	meta,
	children,
	glyph,
	className,
	testId,
}: {
	id: MarkId;
	state?: string;
	/** The state in words, for the hint and screen readers: "Critical". */
	word: string;
	meta?: string;
	children?: ReactNode;
	glyph?: ReactNode;
	className?: string;
	testId?: string;
}) {
	const look = markLook(id, state);
	return (
		<Hint label={word} meta={meta}>
			<span
				role="img"
				aria-label={`${look.label}: ${word}`}
				className={cn(
					"inline-flex shrink-0 items-center gap-1 tabular-nums",
					className,
				)}
				data-mark={id}
				data-state={state}
				data-testid={testId}
			>
				{glyph ?? (
					<look.icon
						aria-hidden
						className={cn("size-3.5 shrink-0 stroke-[1.75]", look.className)}
					/>
				)}
				{children}
			</span>
		</Hint>
	);
}
