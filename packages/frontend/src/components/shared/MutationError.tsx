// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

interface MutationErrorProps {
	error: Error | null | undefined;
	className?: string;
}

/** A failed write, in the State family's Problem shape: a danger bar and the server's sentence. */
export function MutationError({ error, className }: MutationErrorProps) {
	if (!error) return null;

	return (
		<div
			role="alert"
			className={cn(
				"flex items-start gap-2.5 text-body text-text-1",
				className,
			)}
		>
			<span
				aria-hidden
				className="mt-1 h-3 w-[3px] shrink-0 rounded-full bg-danger"
			/>
			<span className="min-w-0">{getErrorMessage(error)}</span>
		</div>
	);
}
