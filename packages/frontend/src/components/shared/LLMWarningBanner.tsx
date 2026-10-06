// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LLMWarningBannerProps {
	className?: string;
	/** Optional count of active incidents to show contextual message */
	incidentCount?: number;
	/** The server gate's own words for why no investigation would start (#521). */
	reason?: string;
}

export function LLMWarningBanner({
	className,
	incidentCount,
	reason,
}: LLMWarningBannerProps) {
	const context = incidentCount
		? `You have ${incidentCount} active incident${incidentCount > 1 ? "s" : ""} that could benefit from AI investigation.`
		: null;
	const remedy =
		reason ??
		"Install a coding agent to enable automated incident investigation and recommendations.";
	const message = [context, remedy].filter(Boolean).join(" ");

	return (
		<div
			role="status"
			className={cn(
				"flex flex-wrap items-center gap-2.5 rounded-pool bg-surface-1 px-3.5 py-2.5 text-body",
				className,
			)}
		>
			<span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full bg-warn" />
			<span className="font-medium text-warn">Investigations unavailable</span>
			<span
				className="min-w-0 flex-1 text-text-2"
				data-testid="llm-warning-reason"
			>
				{message}
			</span>
			<Button variant="secondary" size="sm" asChild>
				<Link to="/settings" search={{ tab: "harness" }}>
					Configure agent
				</Link>
			</Button>
		</div>
	);
}
