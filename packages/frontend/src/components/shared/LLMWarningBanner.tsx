// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Link } from "@tanstack/react-router";
import { AlertTriangle, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
		<Alert
			variant="default"
			className={cn(
				"border-amber-500 bg-amber-50 dark:bg-amber-950/20",
				className,
			)}
		>
			<AlertTriangle className="h-4 w-4 text-amber-600" />
			<AlertTitle className="text-amber-900 dark:text-amber-200">
				Investigations Unavailable
			</AlertTitle>
			<AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<span
					className="text-amber-800 dark:text-amber-300"
					data-testid="llm-warning-reason"
				>
					{message}
				</span>
				<Button variant="outline" size="sm" asChild className="w-fit">
					<Link to="/settings" search={{ tab: "harness" }}>
						<Settings className="h-4 w-4 mr-2" />
						Configure agent
					</Link>
				</Button>
			</AlertDescription>
		</Alert>
	);
}
