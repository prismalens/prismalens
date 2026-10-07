// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const RECORD_ROUTES = {
	conversation: "/incidents/$id/conversation",
	report: "/incidents/$id/report",
	alerts: "/incidents/$id/alerts",
	timeline: "/incidents/$id/timeline",
} as const;
export type RecordRoute = keyof typeof RECORD_ROUTES;

/** The one reading column, 52rem and centred at every width; nothing sits beside it (#673 w29). */
export const RECORD_GRID =
	"mx-auto w-full max-w-[calc(var(--reading-w)+2rem)] px-4";

/** One incident tab: the column scrolls, fading over its last 28 px. */
export function RecordPage({
	children,
	testId,
}: {
	children: ReactNode;
	testId?: string;
}) {
	return (
		<div
			className="h-full min-h-0 overflow-y-auto [mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent)]"
			data-testid={testId}
		>
			<div className={cn(RECORD_GRID, "pt-4 pb-12")}>{children}</div>
		</div>
	);
}

/** A tab of this incident, as a link. */
export function RecordLink({
	incidentId,
	to,
	search,
	children,
	className,
	testId,
}: {
	incidentId: string;
	to: RecordRoute;
	search?: Record<string, string>;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<Link
			to={RECORD_ROUTES[to]}
			params={{ id: incidentId }}
			search={(prev: Record<string, unknown>) => ({ ...prev, ...search })}
			viewTransition
			className={cn("text-accent hover:underline", className)}
			data-testid={testId}
		>
			{children}
		</Link>
	);
}

/**
 * A surface-1 pool with its heading, the Overview's and the Report's one
 * section shape; `to` puts the way to that tab at the heading's right.
 */
export function TabSection({
	title,
	count,
	to,
	action,
	incidentId,
	children,
	className,
	testId,
}: {
	title: string;
	count?: number | string;
	to?: RecordRoute;
	/** The words of the link to `to`. */
	action?: string;
	incidentId?: string;
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section
			className={cn("pool mb-3 px-3.5 py-3", className)}
			data-testid={testId}
		>
			<h3 className="mb-2 flex items-center gap-2 text-heading">
				{title}
				{count !== undefined && (
					<span className="text-meta font-normal text-text-3 tabular-nums">
						{count}
					</span>
				)}
				{to && incidentId && action && (
					<RecordLink
						incidentId={incidentId}
						to={to}
						className="ml-auto text-meta font-medium text-text-2 hover:text-text-1 hover:no-underline"
						testId={testId ? `${testId}-heading` : undefined}
					>
						{action}
					</RecordLink>
				)}
			</h3>
			{children}
		</section>
	);
}

/** Rows with a hairline between them, never enclosed. */
export const ROWS =
	"divide-y divide-hairline [&>*]:flex [&>*]:min-w-0 [&>*]:items-start [&>*]:gap-3 [&>*]:py-2";
