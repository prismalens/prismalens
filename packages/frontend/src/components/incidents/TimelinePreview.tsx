"use client";

import type { TimelineEntryWithRelations } from "@prismalens/contracts";
import { Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TimelineEntry } from "./TimelineEntry";

export interface TimelinePreviewProps {
	entries: TimelineEntryWithRelations[];
	totalCount?: number;
	onViewAll?: () => void;
	isLoading?: boolean;
	className?: string;
}

export function TimelinePreview({
	entries,
	totalCount,
	onViewAll,
	isLoading,
	className,
}: TimelinePreviewProps) {
	// Show the most recent 3 entries
	const recentEntries = entries.slice(0, 3);

	if (isLoading) {
		return (
			<Card className={className}>
				<CardHeader className="pb-3">
					<CardTitle className="text-sm font-medium flex items-center gap-2">
						<Clock className="w-4 h-4" />
						Recent Activity
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{[1, 2, 3].map((i) => (
							<div key={i} className="flex items-center gap-3 animate-pulse">
								<div className="w-12 h-4 bg-muted rounded" />
								<div className="w-6 h-6 bg-muted rounded-full" />
								<div className="flex-1 h-4 bg-muted rounded" />
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (recentEntries.length === 0) {
		return (
			<Card className={className}>
				<CardHeader className="pb-3">
					<CardTitle className="text-sm font-medium flex items-center gap-2">
						<Clock className="w-4 h-4" />
						Recent Activity
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground text-center py-4">
						No activity yet. Events will appear here as the incident progresses.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className={className}>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium flex items-center gap-2">
					<Clock className="w-4 h-4" />
					Recent Activity
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-1">
				{recentEntries.map((entry) => (
					<TimelineEntry
						key={entry.id}
						id={entry.id}
						type={entry.type}
						title={entry.title}
						description={null}
						source={entry.source}
						occurredAt={entry.occurredAt}
						user={entry.user}
						compact
					/>
				))}

				{onViewAll && (
					<button
						type="button"
						onClick={onViewAll}
						className={cn(
							"w-full text-sm text-primary hover:underline mt-3 pt-3 border-t",
							"flex items-center justify-center gap-1",
						)}
					>
						View full timeline
						{totalCount && totalCount > 3 && (
							<span className="text-muted-foreground">
								({totalCount} entries)
							</span>
						)}
						<span aria-hidden="true">&rarr;</span>
					</button>
				)}
			</CardContent>
		</Card>
	);
}
