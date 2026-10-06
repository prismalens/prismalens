// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The state family (look ruling §2): one shape each for nothing here, still
 * loading, did not load and not found. Offline is the ReconnectLine only.
 */

/** Nothing here yet: one quiet line, and the one action that fills it. */
export function Empty({
	text,
	action,
	className,
	testId = "state-empty",
}: {
	text: string;
	action?: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-3 py-2.5 text-body text-text-3",
				className,
			)}
			data-testid={testId}
		>
			<span>{text}</span>
			{action}
		</div>
	);
}

/** Loading inside the shell: skeleton rows; the header above stays. */
export function Loading({
	rows = 4,
	className,
}: {
	rows?: number;
	className?: string;
}) {
	return (
		<div
			role="status"
			aria-label="Loading"
			className={cn("space-y-3 py-2", className)}
			data-testid="state-loading"
		>
			{Array.from({ length: rows }, (_, i) => (
				<Skeleton
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder rows
					key={i}
					className="h-3"
					style={{ width: `${88 - ((i * 17) % 40)}%` }}
				/>
			))}
		</div>
	);
}

/**
 * Did not load: a danger bar and one sentence the caller words; never the
 * raw server message. Retry and Back when there is somewhere to go.
 */
export function Problem({
	text,
	onRetry,
	back,
	className,
}: {
	text: string;
	onRetry?: () => void;
	back?: ReactNode;
	className?: string;
}) {
	return (
		<div
			role="alert"
			className={cn(
				"flex flex-wrap items-center gap-2.5 py-2 text-body text-text-1",
				className,
			)}
			data-testid="state-problem"
		>
			<span
				aria-hidden
				className="h-3 w-[3px] shrink-0 rounded-full bg-danger"
			/>
			<span className="min-w-0">{text}</span>
			{onRetry && (
				<Button variant="text" size="sm" onClick={onRetry}>
					Retry
				</Button>
			)}
			{back}
		</div>
	);
}

/** A record that is not there: say so, and the way back. */
export function NotFound({
	text = "This is not here. It may have been deleted.",
	back,
	className,
}: {
	text?: string;
	back: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn("flex flex-col items-start gap-2 py-6", className)}
			data-testid="state-not-found"
		>
			<p className="text-body text-text-1">{text}</p>
			{back}
		</div>
	);
}
