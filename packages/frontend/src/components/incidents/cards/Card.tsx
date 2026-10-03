// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CARD_ROUTES = {
	conversation: "/incidents/$id/conversation",
	report: "/incidents/$id/report",
	alerts: "/incidents/$id/alerts",
	timeline: "/incidents/$id/timeline",
} as const;
export type CardRoute = keyof typeof CARD_ROUTES;

/**
 * One bounded card on the incident page (#743 §3c): a title, a few facts,
 * and a link to the route that holds everything that grows.
 */
export function Card({
	title,
	count,
	aside,
	tone,
	children,
	className,
	testId,
}: {
	title?: string;
	count?: ReactNode;
	aside?: ReactNode;
	/** A tinted card wants attention: a failed run, a Needs you. */
	tone?: "failed" | "critical" | "done";
	children: ReactNode;
	className?: string;
	testId?: string;
}) {
	return (
		<section
			className={cn(
				"min-w-0 space-y-2 rounded-md p-3",
				!tone && "bg-surface-3/40",
				tone === "failed" && "bg-danger/10",
				tone === "critical" && "bg-sev-critical/8",
				tone === "done" && "bg-ok/8",
				className,
			)}
			data-testid={testId}
		>
			{title && (
				<div className="flex min-h-6 items-center gap-2">
					<h2 className="text-body font-medium">{title}</h2>
					{count !== undefined && (
						<span className="text-meta text-text-2 tabular-nums">{count}</span>
					)}
					{aside && (
						<div className="ml-auto flex shrink-0 items-center gap-2">
							{aside}
						</div>
					)}
				</div>
			)}
			{children}
		</section>
	);
}

/** `See all`, `Open conversation`: a card's way to its route under the incident. */
export function CardLink({
	incidentId,
	to,
	children,
	testId,
}: {
	incidentId: string;
	to: CardRoute;
	children: ReactNode;
	testId?: string;
}) {
	return (
		<Link
			to={CARD_ROUTES[to]}
			params={{ id: incidentId }}
			search={true}
			viewTransition
			className="text-meta whitespace-nowrap text-accent hover:underline"
			data-testid={testId}
		>
			{children}
		</Link>
	);
}
