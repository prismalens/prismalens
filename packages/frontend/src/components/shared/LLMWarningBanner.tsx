"use client";

import { Link } from "@tanstack/react-router";
import { AlertTriangle, Settings } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LLMWarningBannerProps {
	className?: string;
}

export function LLMWarningBanner({ className }: LLMWarningBannerProps) {
	return (
		<Alert
			variant="default"
			className={cn("border-amber-500 bg-amber-50 dark:bg-amber-950/20", className)}
		>
			<AlertTriangle className="h-4 w-4 text-amber-600" />
			<AlertTitle className="text-amber-900 dark:text-amber-200">
				AI Provider Not Configured
			</AlertTitle>
			<AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
				<span className="text-amber-800 dark:text-amber-300">
					Configure an AI provider to enable automated incident investigation
					and recommendations.
				</span>
				<Button variant="outline" size="sm" asChild className="w-fit">
					<Link to="/settings">
						<Settings className="h-4 w-4 mr-2" />
						Configure AI
					</Link>
				</Button>
			</AlertDescription>
		</Alert>
	);
}
